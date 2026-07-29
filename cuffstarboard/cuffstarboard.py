"""CuffStarboard — the commendation board.

React with enough ⭐ (or a configured custom emoji) and the message is
reposted to the configured board channel. Each message boards exactly once;
the claim is taken under a per-guild lock BEFORE sending so two
near-simultaneous reactions can never double-post, and a failed send rolls
the claim back so a later star retries.

Ported from the CuffBot Node module ``src/modules/starboard`` — strings and
behavior are kept verbatim.
"""

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Optional

import discord
from redbot.core import Config, checks, commands

log = logging.getLogger("red.cuff-cogs.cuffstarboard")

LIVE_NODE_JSON = "/home/brand/CuffBot/data/411157175948541954.json"

MAX_CONTENT = 1000
KEEP_BOARDED = 1000
BOARD_COLOR = 0xF5B041

_CUSTOM_EMOJI_RE = re.compile(r"^<a?:\w+:(\d{15,21})>$")
_EMOJI_ID_RE = re.compile(r"^\d{15,21}$")
_PLAIN_WORD_RE = re.compile(r"^[\w\s]+$", re.ASCII)


# ---------------------------------------------------------------------------
# Pure rules (ported from src/modules/starboard/lib/board.js) — no discord.py
# objects so they stay unit-testable.
# ---------------------------------------------------------------------------


def should_board(
    *,
    emoji_name: str,
    emoji_id: Optional[str],
    count: int,
    config: dict,
    message_channel_id: Optional[int],
    already_boarded: bool,
) -> tuple[bool, Optional[str]]:
    """Should this reaction state put the message on the board?

    The configured emoji is either a unicode character (matched against the
    reaction NAME) or a custom-emoji ID (matched against the reaction ID —
    names are not unique). Returns ``(board, refusal_reason)``.
    """
    if not config["enabled"]:
        return False, "disabled"
    if not config["channel_id"]:
        return False, "no-channel"
    if config["emoji"] != emoji_name and config["emoji"] != emoji_id:
        return False, "wrong-emoji"
    if message_channel_id is not None and int(message_channel_id) == int(config["channel_id"]):
        return False, "board-channel"
    if already_boarded:
        return False, "already-boarded"
    if (count or 0) < config["threshold"]:
        return False, "below-threshold"
    return True, None


def parse_emoji_input(raw: str) -> Optional[str]:
    """Parse an admin's emoji input.

    A custom-emoji mention (``<:name:id>`` or animated ``<a:name:id>``) or a
    bare custom-emoji ID stores the ID; anything else short and non-empty is
    treated as a unicode emoji and stored verbatim. Returns the value to
    store, or ``None`` when the input is not an emoji we can watch for.
    """
    text = str(raw or "").strip()
    custom = _CUSTOM_EMOJI_RE.match(text)
    if custom:
        return custom.group(1)
    if _EMOJI_ID_RE.match(text):
        return text
    # <=16 UTF-16-ish units allows ZWJ sequences (👮‍♂️, flags); reject plain words.
    if len(text) == 0 or len(text) > 16 or _PLAIN_WORD_RE.match(text):
        return None
    return text


def display_emoji(value: str) -> str:
    """How a stored emoji value renders (custom ids need the mention form)."""
    return f"<:e:{value}>" if _EMOJI_ID_RE.match(str(value)) else str(value)


def text_from_embeds(embeds) -> str:
    """Harvest readable text from a message's embeds — the only text an
    embed-only message (bot posts, link previews) has."""
    parts = []
    for embed in embeds or []:
        if embed.title:
            parts.append(str(embed.title))
        if embed.description:
            parts.append(str(embed.description))
        for field in embed.fields:
            if field.name:
                parts.append(str(field.name))
            if field.value:
                parts.append(str(field.value))
    return "\n".join(parts).strip()


def trim_content(content: str) -> str:
    """The board post's body text: trimmed, bounded, never empty."""
    content = str(content or "").strip()
    if len(content) > MAX_CONTENT:
        content = content[: MAX_CONTENT - 1] + "…"
    if not content:
        content = "_(no text — see the original message)_"
    return content


def record_boarded(order: list, posts: dict, message_id: str, board_message_id: str, keep: int = KEEP_BOARDED):
    """Record a boarded message, bounding the store's size (oldest out)."""
    order = list(order or [])
    if message_id not in order:
        order.append(message_id)
    order = order[-keep:]
    kept = set(order)
    posts = {mid: bid for mid, bid in {**(posts or {}), message_id: board_message_id}.items() if mid in kept}
    return order, posts


class CuffStarboard(commands.Cog):
    """The commendation board: channel, threshold, emoji."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175004, force_registration=True)
        self.config.register_guild(
            enabled=True,
            channel_id=None,
            threshold=3,
            emoji="⭐",
            posted_order=[],  # message ids as str, oldest first, last 1000
            posted_map={},  # message_id -> board_message_id or "pending"
        )
        self._locks: dict[int, asyncio.Lock] = {}

    def cog_unload(self):
        self._locks.clear()

    async def red_delete_data_for_user(self, *, requester, user_id: int):
        """Nothing to delete: the cog stores message IDs, not user data."""
        return

    # ------------------------------------------------------------------
    # Reaction watcher
    # ------------------------------------------------------------------

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload: discord.RawReactionActionEvent):
        try:
            await self._handle_reaction(payload)
        except Exception:
            # A reaction must never crash the gateway handlers.
            log.warning("Starboard: reaction handling failed", exc_info=True)

    async def _handle_reaction(self, payload: discord.RawReactionActionEvent):
        if payload.guild_id is None:
            return
        guild = self.bot.get_guild(payload.guild_id)
        if guild is None:
            return
        reactor = payload.member or guild.get_member(payload.user_id)
        if payload.user_id == getattr(self.bot.user, "id", None) or (reactor and reactor.bot):
            return

        conf = await self.config.guild(guild).all()

        # Refusals that need no message fetch — in the canonical order:
        # disabled → no channel → wrong emoji → board channel → already
        # boarded → (below threshold, checked after the fetch).
        if not conf["enabled"]:
            return
        if not conf["channel_id"]:
            return
        emoji_name = payload.emoji.name or ""
        emoji_id = str(payload.emoji.id) if payload.emoji.id else None
        if conf["emoji"] != emoji_name and conf["emoji"] != emoji_id:
            return
        if int(payload.channel_id) == int(conf["channel_id"]):
            return
        if str(payload.message_id) in conf["posted_map"]:
            return

        channel = guild.get_channel_or_thread(payload.channel_id)
        if channel is None:
            return
        try:
            message = await channel.fetch_message(payload.message_id)
        except (discord.NotFound, discord.Forbidden) as error:
            log.debug("Starboard: could not fetch reacted message %s: %s", payload.message_id, error)
            return
        except discord.HTTPException as error:
            log.warning("Starboard: fetching reacted message %s failed: %s", payload.message_id, error)
            return

        # Star count for the configured emoji, from the fetched message.
        stars = conf["threshold"]
        for reaction in message.reactions:
            r_name = reaction.emoji if isinstance(reaction.emoji, str) else (reaction.emoji.name or "")
            r_id = None if isinstance(reaction.emoji, str) else (str(reaction.emoji.id) if reaction.emoji.id else None)
            if conf["emoji"] == r_name or conf["emoji"] == r_id:
                stars = reaction.count
                break

        board, _reason = should_board(
            emoji_name=emoji_name,
            emoji_id=emoji_id,
            count=stars,
            config=conf,
            message_channel_id=message.channel.id,
            already_boarded=str(message.id) in conf["posted_map"],
        )
        if not board:
            return

        # The board must always show the text. If the fetched content still
        # looks empty, force a fresh REST fetch; embed-only messages (bot
        # posts, link previews) keep their text in the embeds.
        content = message.content or ""
        if not content:
            try:
                fresh = await channel.fetch_message(payload.message_id)
            except discord.HTTPException:
                fresh = None
            if fresh is not None:
                message = fresh
                content = fresh.content or ""
        if not content:
            content = text_from_embeds(message.embeds)

        await self._board_message(guild, message, content, stars, conf)

    async def _board_message(self, guild: discord.Guild, message: discord.Message, content: str, stars: int, conf: dict):
        board_channel = guild.get_channel(int(conf["channel_id"]))
        if board_channel is None or not isinstance(board_channel, (discord.TextChannel, discord.Thread)):
            return False

        gconf = self.config.guild(guild)
        message_id = str(message.id)
        lock = self._locks.setdefault(guild.id, asyncio.Lock())

        # Claim BEFORE sending so two near-simultaneous reactions can never
        # double-post; a failed send rolls the claim back so a later star
        # retries.
        async with lock:
            posted_map = await gconf.posted_map()
            if message_id in posted_map:
                return False
            order = await gconf.posted_order()
            order, posted_map = record_boarded(order, posted_map, message_id, "pending")
            await gconf.posted_order.set(order)
            await gconf.posted_map.set(posted_map)

        embed = self._board_embed(message, content, stars)
        try:
            posted = await board_channel.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
        except discord.HTTPException as error:
            log.warning("Starboard: posting to the board failed: %s", error)
            async with lock:
                posted_map = await gconf.posted_map()
                posted_map.pop(message_id, None)
                order = [mid for mid in await gconf.posted_order() if mid != message_id]
                await gconf.posted_order.set(order)
                await gconf.posted_map.set(posted_map)
            return False

        async with lock:
            order = await gconf.posted_order()
            posted_map = await gconf.posted_map()
            order, posted_map = record_boarded(order, posted_map, message_id, str(posted.id))
            await gconf.posted_order.set(order)
            await gconf.posted_map.set(posted_map)
        return True

    def _board_embed(self, message: discord.Message, content: str, stars: int) -> discord.Embed:
        author = message.author
        author_name = getattr(author, "display_name", None) or getattr(author, "name", "Unknown officer")
        embed = discord.Embed(
            color=BOARD_COLOR,
            description=(
                f"{trim_content(content)}\n\n"
                f"[Jump to the original]({message.jump_url}) · <#{message.channel.id}>"
            ),
        )
        embed.set_author(name=author_name, icon_url=author.display_avatar.url if author else None)
        for attachment in message.attachments:
            if (attachment.content_type or "").startswith("image/"):
                embed.set_image(url=attachment.url)
                break
        embed.set_footer(text=f"⭐ {stars} — Commendation Board")
        return embed

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @commands.group(name="starboard", invoke_without_command=True)
    @commands.guild_only()
    @checks.admin_or_permissions(manage_guild=True)
    async def starboard(self, ctx: commands.Context):
        """The commendation board: channel, threshold, emoji (admin)."""
        if ctx.invoked_subcommand is not None:
            return
        conf = await self.config.guild(ctx.guild).all()
        channel_line = (
            f"<#{conf['channel_id']}>"
            if conf["channel_id"]
            else "⚠️ not set — nothing is boarded until an admin picks one"
        )
        lines = [
            f"**Enabled:** {'yes' if conf['enabled'] else 'no'}",
            f"**Channel:** {channel_line}",
            f"**Threshold:** {conf['threshold']} × {display_emoji(conf['emoji'])}",
            f"**Boarded so far:** {len(conf['posted_order'])}",
            "",
            f"React with {display_emoji(conf['emoji'])} on any message; at {conf['threshold']} "
            "reactions it earns a spot on the board. Each message boards once.",
        ]
        embed = discord.Embed(title="⭐ Starboard", color=BOARD_COLOR, description="\n".join(lines))
        await ctx.send(embed=embed)

    @starboard.command(name="on")
    async def starboard_on(self, ctx: commands.Context):
        """Turn the starboard on."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await ctx.send("✅ The commendation board is **open**.")

    @starboard.command(name="off")
    async def starboard_off(self, ctx: commands.Context):
        """Turn the starboard off."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.send("📴 The commendation board is **closed**.")

    @starboard.command(name="channel")
    async def starboard_channel(self, ctx: commands.Context, channel: discord.TextChannel):
        """Channel where starred messages are reposted."""
        await self.config.guild(ctx.guild).channel_id.set(channel.id)
        await ctx.send(f"✅ Commendations land in <#{channel.id}>.")

    @starboard.command(name="threshold")
    async def starboard_threshold(self, ctx: commands.Context, stars: int):
        """Stars needed to board a message (1–25)."""
        if stars < 1 or stars > 25:
            await ctx.send("🚫 The threshold must be 1–25 stars.")
            return
        await self.config.guild(ctx.guild).threshold.set(stars)
        await ctx.send(f"✅ Messages board at **{stars}** reactions.")

    @starboard.command(name="emoji")
    async def starboard_emoji(self, ctx: commands.Context, emoji: str):
        """Reaction that counts: a unicode emoji (🌟) or a custom server emoji."""
        parsed = parse_emoji_input(emoji)
        if parsed is None:
            await ctx.send(
                f"🚫 `{emoji}` is not an emoji I can watch for. Use a unicode emoji (like 🌟 or 🍩) "
                "or pick a custom server emoji from the emoji picker so it looks like `<:name:id>`."
            )
            return
        await self.config.guild(ctx.guild).emoji.set(parsed)
        await ctx.send(f"✅ The board now counts {display_emoji(parsed)} reactions.")

    @starboard.command(name="migratecuff")
    @checks.is_owner()
    async def starboard_migratecuff(self, ctx: commands.Context, mode: str = "apply", path: str = LIVE_NODE_JSON):
        """Migrate starboard settings from the CuffBot Node data file.

        `mode` is `preview` (show what would be written) or `apply` (default).
        An optional path after the mode overrides the Node JSON location.
        Only keys present in the Node JSON are written; absent keys stay at
        the cog defaults. Safe to run more than once.
        """
        mode = mode.lower()
        if mode not in ("preview", "apply"):
            await ctx.send(
                f"🚫 Unknown mode `{mode}`. Use `{ctx.clean_prefix}starboard migratecuff preview` "
                f"or `{ctx.clean_prefix}starboard migratecuff apply`."
            )
            return
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            await ctx.send(f"🚫 Could not read the Node data file at `{path}`: {error}")
            return

        changes = {}
        node_config = data.get("starboardConfig")
        if isinstance(node_config, dict):
            if "enabled" in node_config:
                changes["enabled"] = bool(node_config["enabled"])
            if "channelId" in node_config and node_config["channelId"]:
                changes["channel_id"] = int(node_config["channelId"])
            if "threshold" in node_config:
                changes["threshold"] = int(node_config["threshold"])
            if "emoji" in node_config:
                changes["emoji"] = str(node_config["emoji"])
        node_posted = data.get("starboardPosted")
        if isinstance(node_posted, dict):
            if "order" in node_posted:
                changes["posted_order"] = [str(mid) for mid in node_posted["order"]][-KEEP_BOARDED:]
            if "posts" in node_posted:
                changes["posted_map"] = {str(mid): str(bid) for mid, bid in node_posted["posts"].items()}

        if not changes:
            await ctx.send("Nothing to migrate: the Node data file has no starboard keys.")
            return

        summary = "\n".join(
            f"{key} = {value if not isinstance(value, (list, dict)) else f'<{len(value)} entries>'}"
            for key, value in changes.items()
        )
        if mode == "preview":
            await ctx.send(f"**Starboard migration preview** (nothing written):\n```\n{summary}\n```")
            return

        gconf = self.config.guild(ctx.guild)
        for key, value in changes.items():
            await gconf.get_attr(key).set(value)
        await ctx.send(f"✅ Starboard migration applied:\n```\n{summary}\n```")
