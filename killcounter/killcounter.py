"""KillCounter — chat kills.

When a channel goes quiet after someone speaks, the last word scores a
point: you killed the conversation; you get the credit. Any new eligible
message REPLACES the pending kill — that replacement is the reset, and it
is why a busy channel never scores: only the final speaker before the
silence is holding the knife.

The pending state is RAM-only, on purpose: a pending kill that a restart
loses is one point in a game, and persisting a countdown would mean a disk
write on every message. Ported from the CuffBot Node module
``src/modules/killcounter`` — strings and behavior are kept verbatim.

One deliberate departure from the Node module: a scored kill is **announced**
in the channel that died. The Node version scored in complete silence, so the
board only moved for people who thought to run the command. Announcing there
is safe because the bot's own message is not activity — `_note_message` drops
bot authors — so the announcement cannot arm a fresh kill on itself.
"""

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Optional

import discord
from redbot.core import Config, checks, commands

log = logging.getLogger("red.cuff-cogs.killcounter")

LIVE_NODE_JSON = "/home/brand/CuffBot/data/411157175948541954.json"

BOARD_COLOR = 0x4A4A4A
MEDALS = ["🥇", "🥈", "🥉"]


def _seconds(ms: int) -> str:
    return f"{round(ms / 1000)} s"


def _now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Pure rules (ported from src/modules/killcounter/lib/killcounter.js) — `now`
# is injected everywhere so the timing is testable without waiting.
# ---------------------------------------------------------------------------


def is_command_line(content: str, prefix: str) -> bool:
    """The router's own rule: a lone prefix or "! spaced" is not a command."""
    if not isinstance(content, str) or not prefix or not content.startswith(prefix):
        return False
    body = content[len(prefix):]
    return len(body) > 0 and not body[0].isspace()


def is_eligible(*, enabled: bool, author_is_bot: bool, channel_id: str, channel_ids: list, content: str, ignore_commands: bool, prefixes: list) -> bool:
    """Is this message a "last word" that could kill the channel?"""
    if not enabled:
        return False
    if author_is_bot:
        return False
    if channel_ids and str(channel_id) not in channel_ids:
        return False
    if ignore_commands and any(is_command_line(content, prefix) for prefix in prefixes):
        return False
    return True


def resolve_silence(pending: Optional[tuple], now: int, silence_ms: int) -> tuple[Optional[tuple], Optional[int]]:
    """Has the pending speaker earned the point yet?

    Returns ``(pending, award_user_id)`` — the award comes with a CLEARED
    pending, which is what makes scoring idempotent: a second call cannot
    award the same silence twice, so a stray extra timer tick is harmless.
    """
    if pending is None:
        return None, None
    user_id, at = pending
    if now - at < silence_ms:
        return pending, None  # spoke again recently
    return None, user_id


def sort_scores(scores: dict, limit: Optional[int] = None) -> list:
    """Highest kill count first; ties broken by the most recent kill.

    ``scores`` maps user_id -> {"kills": int, "last_kill_at": int}; rows with
    zero kills are dropped. Returns ``[(user_id, kills, last_kill_at), ...]``.
    """
    rows = [
        (user_id, record.get("kills", 0), record.get("last_kill_at", 0))
        for user_id, record in (scores or {}).items()
        if record.get("kills", 0) > 0
    ]
    rows.sort(key=lambda row: (-row[1], -row[2]))
    return rows[: max(1, limit)] if limit is not None else rows


def standing_for(scores: dict, user_id) -> tuple[int, Optional[int], int]:
    """Someone's own standing: ``(kills, rank_or_None, board_size)``."""
    rows = sort_scores(scores)
    for index, (row_id, kills, _at) in enumerate(rows):
        if str(row_id) == str(user_id):
            return kills, index + 1, len(rows)
    return 0, None, len(rows)


class KillCounter(commands.Cog):
    """Chat kills: go quiet after someone speaks and the last word scores."""

    __version__ = "1.1.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175005, force_registration=True)
        self.config.register_guild(
            enabled=True,
            silence_ms=30000,
            channel_ids=[],  # channel ids as str; empty = every channel
            ignore_commands=True,
            announce=True,
        )
        self.config.register_member(
            kills=0,
            last_kill_at=0,
        )
        # channel_id -> {"pending": (user_id, at_ms), "handle": asyncio.Task}.
        # RAM only, by design (see the module docstring).
        self._channels: dict[int, dict] = {}

    def cog_unload(self):
        for entry in self._channels.values():
            handle = entry.get("handle")
            if handle is not None:
                handle.cancel()
        self._channels.clear()

    async def red_delete_data_for_user(self, *, requester, user_id: int):
        all_members = await self.config.all_members()
        for guild_id, members in all_members.items():
            if user_id in members:
                await self.config.member_from_ids(guild_id, user_id).clear()

    # ------------------------------------------------------------------
    # Message watcher and the silence timers
    # ------------------------------------------------------------------

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.guild is None:
            return
        try:
            await self._note_message(message)
        except Exception:
            log.warning("Kill counter: could not note a message", exc_info=True)

    async def _note_message(self, message: discord.Message):
        conf = await self.config.guild(message.guild).all()
        if not conf["enabled"] or message.author.bot:
            return
        prefixes = await self.bot.get_valid_prefixes(message.guild) if conf["ignore_commands"] else []
        if not is_eligible(
            enabled=conf["enabled"],
            author_is_bot=message.author.bot,
            channel_id=str(message.channel.id),
            channel_ids=conf["channel_ids"],
            content=message.content or "",
            ignore_commands=conf["ignore_commands"],
            prefixes=prefixes,
        ):
            return

        channel_id = message.channel.id
        existing = self._channels.get(channel_id)
        if existing is not None and existing.get("handle") is not None:
            existing["handle"].cancel()

        # Record who spoke last: any new message replaces the pending kill —
        # the replacement IS the reset — and re-arms the silence timer.
        pending = (message.author.id, _now_ms())
        handle = asyncio.create_task(
            self._silence_timer(message.guild.id, channel_id, conf["silence_ms"])
        )
        self._channels[channel_id] = {"pending": pending, "handle": handle}

    async def _silence_timer(self, guild_id: int, channel_id: int, silence_ms: int):
        try:
            # A hair of padding so an early wake-up cannot land just under
            # the threshold and drop the award.
            await asyncio.sleep(silence_ms / 1000 + 0.05)
        except asyncio.CancelledError:
            return
        try:
            await self._fire_silence(guild_id, channel_id)
        except Exception:
            log.warning("Kill counter: resolving a silence failed", exc_info=True)

    async def _fire_silence(self, guild_id: int, channel_id: int):
        """The silence elapsed. Award the pending speaker if they really did
        go quiet — the pending is cleared as it awards, so a duplicate tick
        cannot double-score."""
        entry = self._channels.get(channel_id)
        if entry is None:
            return None
        silence_ms = await self.config.guild_from_id(guild_id).silence_ms()
        now = _now_ms()
        pending, award = resolve_silence(entry.get("pending"), now, silence_ms)
        if award is None:
            # A newer message already replaced the pending — timers are
            # always cancelled+rearmed, so this is only a safety check.
            entry["pending"] = pending
            return None
        self._channels.pop(channel_id, None)
        member_conf = self.config.member_from_ids(guild_id, award)
        kills = await member_conf.kills() + 1
        await member_conf.kills.set(kills)
        await member_conf.last_kill_at.set(now)
        await self._announce_kill(guild_id, channel_id, award, kills)
        return award, kills

    async def _announce_kill(self, guild_id: int, channel_id: int, user_id: int, kills: int):
        """Name the killer in the channel they killed.

        Scored *after* the counters are written, so the rank shown is the one
        this kill just earned. Never raises: a game point is not worth losing
        the award over a channel the bot cannot post in.
        """
        guild = self.bot.get_guild(guild_id)
        if guild is None:
            return
        if not await self.config.guild(guild).announce():
            return
        channel = guild.get_channel(channel_id)
        if not isinstance(channel, (discord.TextChannel, discord.Thread)):
            return
        perms = channel.permissions_for(guild.me)
        if not (perms.send_messages and perms.embed_links):
            log.warning(
                "Kill counter: cannot announce in %s — need Send Messages and Embed Links",
                channel_id,
            )
            return
        _kills, rank, of = standing_for(await self._scores(guild), user_id)
        lines = [f"<@{user_id}> — kill **#{kills}**"]
        if rank:
            lines.append(f"#{rank} of {of} on the board")
        embed = discord.Embed(
            color=BOARD_COLOR, title="💀 Chat killed", description="\n".join(lines)
        )
        try:
            await channel.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
        except discord.HTTPException as error:
            log.warning("Kill counter: announcing a kill failed: %s", error)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _scores(self, guild: discord.Guild) -> dict:
        return await self.config.all_members(guild)

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @commands.group(name="killcounter", aliases=["kills", "chatkills"], invoke_without_command=True)
    @commands.guild_only()
    async def killcounter(self, ctx: commands.Context):
        """Chat kills: go quiet after someone speaks and the last word scores."""
        if ctx.invoked_subcommand is not None:
            return
        conf = await self.config.guild(ctx.guild).all()
        kills, rank, of = standing_for(await self._scores(ctx.guild), ctx.author.id)
        channels = (
            "everywhere"
            if not conf["channel_ids"]
            else ", ".join(f"<#{cid}>" for cid in conf["channel_ids"])
        )
        lines = [
            f"**Enabled:** {'🟢 yes' if conf['enabled'] else '🔴 no'}",
            f"**Silence needed:** {_seconds(conf['silence_ms'])}",
            f"**Channels:** {channels}",
            f"**Announce kills:** {'🟢 yes' if conf['announce'] else '🔴 no — the board is silent'}",
            f"**Your kills:** {kills}" + (f" — #{rank} of {of}" if rank else ""),
        ]
        embed = discord.Embed(title="💀 Kill counter", color=BOARD_COLOR, description="\n".join(lines))
        await ctx.send(embed=embed)

    @killcounter.command(name="me", aliases=["stats"])
    async def killcounter_me(self, ctx: commands.Context, member: discord.Member = None):
        """How many conversations you have killed."""
        target = member or ctx.author
        kills, rank, of = standing_for(await self._scores(ctx.guild), target.id)
        who = "You have" if target.id == ctx.author.id else f"{target.mention} has"
        if kills == 0:
            content = f"💀 {who} not killed a single conversation. Impressive restraint."
        else:
            content = f"💀 {who} **{kills}** chat kill{'' if kills == 1 else 's'} — #{rank} of {of}."
        await ctx.send(content, allowed_mentions=discord.AllowedMentions.none())

    @killcounter.command(name="board", aliases=["leaderboard", "top"])
    async def killcounter_board(self, ctx: commands.Context, size: int = 10):
        """The precinct's deadliest conversationalists (top 1–25)."""
        size = max(1, min(25, size))
        rows = sort_scores(await self._scores(ctx.guild), size)
        embed = discord.Embed(color=BOARD_COLOR, title="💀 Chat Kill Board")
        if not rows:
            embed.description = "No conversations have died yet. The precinct is unusually chatty."
        else:
            embed.description = "\n".join(
                f"{MEDALS[i] if i < len(MEDALS) else f'**{i + 1}.**'} <@{user_id}> — **{kills}**"
                for i, (user_id, kills, _at) in enumerate(rows)
            )
            silence_ms = await self.config.guild(ctx.guild).silence_ms()
            embed.set_footer(text=f"Say the last word and let {_seconds(silence_ms)} pass.")
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())

    @killcounter.command(name="on")
    @checks.admin_or_permissions(manage_guild=True)
    async def killcounter_on(self, ctx: commands.Context):
        """Start counting chat kills."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await ctx.send("💀 Chat kills are being counted.")

    @killcounter.command(name="off")
    @checks.admin_or_permissions(manage_guild=True)
    async def killcounter_off(self, ctx: commands.Context):
        """Stop counting chat kills."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.send("💀 Chat kills are no longer counted. Existing scores are kept.")

    @killcounter.command(name="announce")
    @checks.admin_or_permissions(manage_guild=True)
    async def killcounter_announce(self, ctx: commands.Context, state: bool):
        """Post a message in the channel whenever someone scores a kill."""
        await self.config.guild(ctx.guild).announce.set(state)
        await ctx.send(
            "💀 Kills are announced in the channel that died."
            if state
            else f"💀 Kills are counted quietly — check `{ctx.clean_prefix}killcounter board`."
        )

    @killcounter.command(name="silence")
    @checks.admin_or_permissions(manage_guild=True)
    async def killcounter_silence(self, ctx: commands.Context, seconds: int):
        """How long the quiet must last to score (5–3600 seconds)."""
        if seconds < 5 or seconds > 3600:
            await ctx.send("🚫 The silence must be 5–3600 seconds.")
            return
        await self.config.guild(ctx.guild).silence_ms.set(seconds * 1000)
        await ctx.send(f"💀 A kill now needs **{seconds} s** of silence.")

    @killcounter.command(name="channel")
    @checks.admin_or_permissions(manage_guild=True)
    async def killcounter_channel(self, ctx: commands.Context, channel: discord.TextChannel):
        """Count only in these channels — run it per channel to add."""
        gconf = self.config.guild(ctx.guild)
        channel_ids = list(await gconf.channel_ids())
        cid = str(channel.id)
        if cid in channel_ids:
            channel_ids.remove(cid)
            await gconf.channel_ids.set(channel_ids)
            suffix = " The list is empty, so kills count **everywhere** again." if not channel_ids else ""
            content = f"💀 {channel.mention} is no longer counted.{suffix}"
        else:
            channel_ids.append(cid)
            await gconf.channel_ids.set(channel_ids)
            rendered = ", ".join(f"<#{c}>" for c in channel_ids)
            content = f"💀 {channel.mention} added — kills now count **only** in {rendered}."
        await ctx.send(content, allowed_mentions=discord.AllowedMentions.none())

    @killcounter.command(name="everywhere")
    @checks.admin_or_permissions(manage_guild=True)
    async def killcounter_everywhere(self, ctx: commands.Context):
        """Count in every channel again (clears the channel list)."""
        await self.config.guild(ctx.guild).channel_ids.set([])
        await ctx.send("💀 Chat kills count in **every** channel again.")

    @killcounter.command(name="reset")
    @checks.admin_or_permissions(manage_guild=True)
    async def killcounter_reset(self, ctx: commands.Context, confirm: str = None):
        """Wipe every score (irreversible)."""
        if confirm != "confirm":
            await ctx.send(
                f"🚫 That wipes every score. Run `{ctx.clean_prefix}killcounter reset confirm` if you mean it."
            )
            return
        await self.config.clear_all_members(ctx.guild)
        await ctx.send("💀 The board is clean. Nobody has killed anything.")

    @killcounter.command(name="migratecuff")
    @checks.is_owner()
    async def killcounter_migratecuff(self, ctx: commands.Context, mode: str = "apply", path: str = LIVE_NODE_JSON):
        """Migrate kill counter settings and scores from the CuffBot Node data file.

        `mode` is `preview` (show what would be written) or `apply` (default).
        An optional path after the mode overrides the Node JSON location.
        Only keys present in the Node JSON are written; absent keys stay at
        the cog defaults. Safe to run more than once.
        """
        mode = mode.lower()
        if mode not in ("preview", "apply"):
            await ctx.send(
                f"🚫 Unknown mode `{mode}`. Use `{ctx.clean_prefix}killcounter migratecuff preview` "
                f"or `{ctx.clean_prefix}killcounter migratecuff apply`."
            )
            return
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            await ctx.send(f"🚫 Could not read the Node data file at `{path}`: {error}")
            return

        guild_changes = {}
        node_config = data.get("killCounterConfig")
        if isinstance(node_config, dict):
            if "enabled" in node_config:
                guild_changes["enabled"] = bool(node_config["enabled"])
            if "silenceMs" in node_config:
                guild_changes["silence_ms"] = int(node_config["silenceMs"])
            if "channelIds" in node_config:
                guild_changes["channel_ids"] = [str(cid) for cid in node_config["channelIds"]]
            if "ignoreCommands" in node_config:
                guild_changes["ignore_commands"] = bool(node_config["ignoreCommands"])

        member_changes = {}
        node_scores = data.get("killCounterScores")
        if isinstance(node_scores, dict):
            for user_id, record in node_scores.items():
                if not isinstance(record, dict):
                    continue
                member_changes[str(user_id)] = {
                    "kills": int(record.get("kills", 0)),
                    "last_kill_at": int(record.get("lastKillAt", 0)),
                }

        if not guild_changes and not member_changes:
            await ctx.send("Nothing to migrate: the Node data file has no kill counter keys.")
            return

        lines = [f"{key} = {value}" for key, value in guild_changes.items()]
        lines += [
            f"member {user_id}: kills={record['kills']}, last_kill_at={record['last_kill_at']}"
            for user_id, record in member_changes.items()
        ]
        summary = "\n".join(lines)
        if mode == "preview":
            await ctx.send(f"**Kill counter migration preview** (nothing written):\n```\n{summary}\n```")
            return

        gconf = self.config.guild(ctx.guild)
        for key, value in guild_changes.items():
            await gconf.get_attr(key).set(value)
        for user_id, record in member_changes.items():
            member_conf = self.config.member_from_ids(ctx.guild.id, int(user_id))
            await member_conf.kills.set(record["kills"])
            await member_conf.last_kill_at.set(record["last_kill_at"])
        await ctx.send(f"✅ Kill counter migration applied:\n```\n{summary}\n```")
