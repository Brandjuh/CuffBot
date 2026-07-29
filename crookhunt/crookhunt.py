"""CrookHunt — police-themed crook hunting, ported from the Node CuffBot.

Crooks spawn in configured channels on a message-driven random schedule.
Catch them by shouting STOP POLICE (words mode) or reacting 🚨 (reaction
mode). Undercover officers must be saluted (🫡), not cuffed. Escaped crooks
pickpocket a random member into the donut pot (CrackPot cog).
"""

import asyncio
import contextlib
import json
import logging
import random
import re
import time
from pathlib import Path
from typing import Literal, Optional

import discord
from redbot.core import Config, bank, checks, commands
from redbot.core.bot import Red
from redbot.core.errors import BalanceTooHigh
from redbot.core.utils.chat_formatting import pagify
from redbot.core.utils.menus import DEFAULT_CONTROLS, menu

log = logging.getLogger("red.cuffcogs.crookhunt")

NODE_DATA_DEFAULT = "/home/brand/CuffBot/data/411157175948541954.json"

CROOKS = [
    {"id": "pickpocket", "emoji": "🦹", "line": "🦹 **_You’ll never catch me!_**", "undercover": False},
    {"id": "burglar", "emoji": "🥷", "line": "🥷 **_Just passing through!_**", "undercover": False},
    {"id": "getaway-driver", "emoji": "🏎️", "line": "🏎️ **_Eat my dust!_**", "undercover": False},
    {"id": "graffiti-tagger", "emoji": "🎨", "line": "🎨 **_The city is my canvas!_**", "undercover": False},
    {"id": "shoplifter", "emoji": "🛍️", "line": "🛍️ **_Five-finger discount!_**", "undercover": False},
    {"id": "smuggler", "emoji": "📦", "line": "📦 **_Nothing to declare!_**", "undercover": False},
    {"id": "mob-boss", "emoji": "🕴️", "line": "🕴️ **_You have no proof!_**", "undercover": False},
    {"id": "undercover-officer", "emoji": "🕵️", "line": "🕵️ **_Psst… I’m on duty here._**", "undercover": True},
]

CATCH_EMOJI = {"🚨", "💥"}
SALUTE_EMOJI = "🫡"
SALUTE_RE = re.compile(r"\bsalutes?\b", re.IGNORECASE)
NON_LETTERS_RE = re.compile(r"[^A-Z]+")

DEFAULT_GUILD = {
    "enabled": True,
    "channels": [412354971170897921],
    "interval_min_s": 900,
    "interval_max_s": 3600,
    "catch_timeout_s": 20,
    "mode": "words",  # "words" | "reaction"
    "show_time": False,
    "undercover": True,
    "reward_min": 100,
    "reward_max": 300,
    "escape_steal_min": 50,
    "escape_steal_max": 250,
}

DEFAULT_MEMBER = {"total": 0, "by_crook": {}}


def is_catch_phrase(content: str) -> bool:
    """The shout must LEAD the message: letters-only uppercase starts with STOPPOLICE."""
    letters = NON_LETTERS_RE.sub("", content.upper())
    return letters.startswith("STOPPOLICE")


def is_salute(content: str) -> bool:
    return SALUTE_EMOJI in content or bool(SALUTE_RE.search(content))


def fumbles() -> bool:
    """Exactly 2 out of 17 attempts fumble (~11.76%), faithful to the source cog."""
    return random.randrange(0, 17) <= 1


def crook_name(crook: dict) -> str:
    return crook["id"].replace("-", " ")


class ActiveHunt:
    __slots__ = ("crook", "spawned_at", "expires_at", "resolved", "timer")

    def __init__(self, crook: dict, spawned_at: float, expires_at: float):
        self.crook = crook
        self.spawned_at = spawned_at
        self.expires_at = expires_at
        self.resolved = False
        self.timer: Optional[asyncio.Task] = None


class CrookHunt(commands.Cog):
    """Hunt crooks for donut bounties. Salute the undercover officer!"""

    def __init__(self, bot: Red):
        super().__init__()
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175007, force_registration=True)
        self.config.register_guild(**DEFAULT_GUILD)
        self.config.register_member(**DEFAULT_MEMBER)
        # RAM-only scheduler state — deliberately non-persistent (re-arms on activity).
        self.next_spawn_at: dict[int, float] = {}  # guild_id -> ms epoch
        self.active_hunts: dict[int, ActiveHunt] = {}  # channel_id -> hunt
        self.pending_spawns: set[int] = set()  # channel ids with a scheduled spawn
        self._tasks: set[asyncio.Task] = set()

    def cog_unload(self):
        for hunt in self.active_hunts.values():
            if hunt.timer:
                hunt.timer.cancel()
        for task in self._tasks:
            task.cancel()
        self.active_hunts.clear()
        self.pending_spawns.clear()

    async def red_delete_data_for_user(
        self,
        *,
        requester: Literal["discord_deleted_user", "owner", "user", "user_strict"],
        user_id: int,
    ):
        all_members = await self.config.all_members()
        for guild_id in all_members:
            await self.config.member_from_ids(guild_id, user_id).clear()

    def _spawn_task(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    # --------------------------------------------------------------- #
    # Economy seams — always degrade, never break the hunt             #
    # --------------------------------------------------------------- #

    async def _reward(self, member: discord.Member, amount: int) -> int:
        try:
            await bank.deposit_credits(member, amount)
        except BalanceTooHigh:
            with contextlib.suppress(Exception):
                await bank.set_balance(member, await bank.get_max_balance(member.guild))
        except Exception:
            log.exception("Reward deposit failed")
            return 0
        return amount

    async def _fine_into_pot(self, member: discord.Member, amount: int) -> int:
        """Take up to `amount` from the member and add it to the donut pot."""
        try:
            balance = await bank.get_balance(member)
            paid = min(balance, amount)
            if paid > 0:
                await bank.withdraw_credits(member, paid)
        except Exception:
            log.exception("Fine withdrawal failed")
            return 0
        await self._add_to_pot(member.guild, paid)
        return paid

    async def _add_to_pot(self, guild: discord.Guild, amount: int) -> Optional[int]:
        pot_cog = self.bot.get_cog("CrackPot")
        if pot_cog is None:
            return None
        try:
            return await pot_cog.add_to_pot(guild, amount)
        except Exception:
            log.exception("add_to_pot failed")
            return None

    async def _record_catch(self, member: discord.Member, crook_id: str):
        async with self.config.member(member).all() as data:
            data["total"] = int(data.get("total", 0)) + 1
            by_crook = data.setdefault("by_crook", {})
            by_crook[crook_id] = int(by_crook.get(crook_id, 0)) + 1

    # --------------------------------------------------------------- #
    # Spawn scheduler (arm-then-schedule, RAM-only)                     #
    # --------------------------------------------------------------- #

    def _next_delay_ms(self, conf: dict) -> int:
        lo = max(60, int(conf["interval_min_s"]))
        hi = max(lo, int(conf["interval_max_s"]))
        return random.randint(lo, hi) * 1000

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or message.guild is None:
            return
        if await self.bot.cog_disabled_in_guild(self, message.guild):
            return
        channel = message.channel
        conf = await self.config.guild(message.guild).all()

        # An active hunt is checked BEFORE scheduling: a STOP POLICE shout
        # never doubles as the activity that schedules the next crook.
        hunt = self.active_hunts.get(channel.id)
        if hunt is not None and not hunt.resolved and conf["mode"] == "words":
            kind = None
            if is_catch_phrase(message.content):
                kind = "cuff"
            elif is_salute(message.content):
                kind = "salute"
            if kind is not None:
                await self._resolve_hunt(channel, message.author, kind, conf)
                return

        # Activity-driven scheduling.
        if not conf["enabled"] or channel.id not in conf["channels"]:
            return
        if channel.id in self.active_hunts or channel.id in self.pending_spawns:
            return
        now_ms = time.time() * 1000
        delay = self._next_delay_ms(conf)
        armed = self.next_spawn_at.get(message.guild.id)
        if armed is None:
            self.next_spawn_at[message.guild.id] = now_ms + delay
            return
        if now_ms < armed:
            return
        self.next_spawn_at[message.guild.id] = now_ms + delay
        self.pending_spawns.add(channel.id)
        self._spawn_task(self._delayed_spawn(channel, delay / 1000))

    async def _delayed_spawn(self, channel: discord.TextChannel, delay_s: float):
        try:
            await asyncio.sleep(delay_s)
            self.pending_spawns.discard(channel.id)
            conf = await self.config.guild(channel.guild).all()
            if conf["enabled"] and channel.id not in self.active_hunts:
                await self._spawn_crook(channel, conf)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Delayed spawn failed")
        finally:
            self.pending_spawns.discard(channel.id)

    async def _spawn_crook(self, channel: discord.TextChannel, conf: dict):
        pool = CROOKS if conf["undercover"] else [c for c in CROOKS if not c["undercover"]]
        crook = random.choice(pool)
        try:
            msg = await channel.send(crook["line"])
        except (discord.Forbidden, discord.HTTPException):
            return
        now = time.time()
        hunt = ActiveHunt(crook, now, now + conf["catch_timeout_s"])
        self.active_hunts[channel.id] = hunt
        if conf["mode"] == "reaction":
            with contextlib.suppress(discord.HTTPException):
                await msg.add_reaction("🚨")
                if crook["undercover"]:
                    await msg.add_reaction(SALUTE_EMOJI)
        hunt.timer = self._spawn_task(self._escape_timer(channel, hunt, conf))

    async def _escape_timer(self, channel: discord.TextChannel, hunt: ActiveHunt, conf: dict):
        try:
            await asyncio.sleep(conf["catch_timeout_s"])
        except asyncio.CancelledError:
            return
        if hunt.resolved or self.active_hunts.get(channel.id) is not hunt:
            return
        hunt.resolved = True
        self.active_hunts.pop(channel.id, None)
        crook = hunt.crook
        try:
            if crook["undercover"]:
                await channel.send(
                    "🕵️ The undercover officer slipped back into the crowd. Nobody saluted."
                )
                return
            victim = self._random_victim(channel.guild)
            stolen = 0
            if victim is not None:
                wanted = random.randint(conf["escape_steal_min"], conf["escape_steal_max"])
                try:
                    balance = await bank.get_balance(victim)
                    stolen = min(balance, wanted)
                    if stolen > 0:
                        await bank.withdraw_credits(victim, stolen)
                except Exception:
                    log.exception("Escape theft failed")
                    stolen = 0
            if victim is not None and stolen > 0:
                pot_balance = await self._add_to_pot(channel.guild, stolen)
                pot_note = (
                    f" (now **{pot_balance:,} 🍩** — `crackpot`)" if pot_balance is not None else ""
                )
                await channel.send(
                    f"💨 **The {crook_name(crook)} got away…** and pickpocketed "
                    f"**{stolen:,} 🍩** from **{victim.display_name}** into the donut pot{pot_note}."
                )
            else:
                await channel.send(f"💨 **The {crook_name(crook)} got away!**")
        except (discord.Forbidden, discord.HTTPException):
            pass

    def _random_victim(self, guild: discord.Guild) -> Optional[discord.Member]:
        humans = [m for m in guild.members if not m.bot]
        return random.choice(humans) if humans else None

    # --------------------------------------------------------------- #
    # Catch resolution                                                  #
    # --------------------------------------------------------------- #

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload: discord.RawReactionActionEvent):
        if payload.guild_id is None:
            return
        hunt = self.active_hunts.get(payload.channel_id)
        if hunt is None or hunt.resolved:
            return
        guild = self.bot.get_guild(payload.guild_id)
        if guild is None:
            return
        if await self.bot.cog_disabled_in_guild(self, guild):
            return
        conf = await self.config.guild(guild).all()
        if conf["mode"] != "reaction":
            return
        emoji = str(payload.emoji)
        if emoji in CATCH_EMOJI:
            kind = "cuff"
        elif emoji == SALUTE_EMOJI:
            kind = "salute"
        else:
            return
        member = guild.get_member(payload.user_id)
        if member is None or member.bot:
            return
        channel = guild.get_channel(payload.channel_id)
        if channel is None:
            return
        await self._resolve_hunt(channel, member, kind, conf)

    async def _resolve_hunt(
        self,
        channel: discord.TextChannel,
        member: discord.Member,
        kind: str,
        conf: dict,
    ):
        hunt = self.active_hunts.get(channel.id)
        now = time.time()
        if hunt is None or hunt.resolved or now >= hunt.expires_at:
            return
        crook = hunt.crook

        # A salute at a regular crook is ignored — no roll consumed.
        if not crook["undercover"] and kind == "salute":
            return

        hunt.resolved = True
        self.active_hunts.pop(channel.id, None)
        if hunt.timer:
            hunt.timer.cancel()

        time_note = ""
        if conf["show_time"]:
            time_note = f" in {now - hunt.spawned_at:.1f}s"
        who = f"**{member.display_name}**"
        name = crook_name(crook)

        try:
            if fumbles():
                await channel.send(f"😬 {who} fumbled the cuffs{time_note} — the {name} got away!")
                return
            reward = random.randint(conf["reward_min"], conf["reward_max"])
            if crook["undercover"]:
                if kind == "salute":
                    paid = await self._reward(member, reward)
                    await self._record_catch(member, crook["id"])
                    await channel.send(
                        f"🫡 {who} saluted the undercover officer{time_note} and earned "
                        f"**{paid:,} 🍩**. Respect."
                    )
                else:
                    paid = await self._fine_into_pot(member, reward)
                    await channel.send(
                        f"🚨 **Oh no!** {who} cuffed an UNDERCOVER OFFICER{time_note} — "
                        f"internal affairs fines **{paid:,} 🍩** into the donut pot. "
                        f"Next time: salute 🫡."
                    )
                return
            paid = await self._reward(member, reward)
            await self._record_catch(member, crook["id"])
            balance = await bank.get_balance(member)
            await channel.send(
                f"🚔 **GOTCHA!** {who} cuffed the {name}{time_note} and earned "
                f"**{paid:,} 🍩** (balance: {balance:,})."
            )
        except (discord.Forbidden, discord.HTTPException):
            pass

    # --------------------------------------------------------------- #
    # Commands                                                          #
    # --------------------------------------------------------------- #

    @commands.group(name="hunting", aliases=["hunt"], invoke_without_command=True)
    @commands.guild_only()
    async def hunting(self, ctx: commands.Context):
        """Crook hunting: status (admins), stats and leaderboard (everyone)."""
        if not ctx.author.guild_permissions.manage_guild:
            await ctx.send(
                f"Use `{ctx.clean_prefix}hunting stats` or `{ctx.clean_prefix}hunting board`."
            )
            return
        conf = await self.config.guild(ctx.guild).all()
        channels = ", ".join(f"<#{c}>" for c in conf["channels"]) or "none"
        armed = self.next_spawn_at.get(ctx.guild.id)
        if armed:
            next_in = max(0, int((armed - time.time() * 1000) / 1000))
            next_note = f"~{next_in // 60} min (once channel activity passes it)"
        else:
            next_note = "unarmed — the next message in a hunt channel arms the clock"
        lines = [
            f"Enabled: **{conf['enabled']}**",
            f"Channels: {channels}",
            f"Interval: **{conf['interval_min_s']}–{conf['interval_max_s']} s**, "
            f"escape window **{conf['catch_timeout_s']} s**",
            f"Mode: **{conf['mode']}** (words = shout STOP POLICE, reaction = press 🚨)",
            f"Bounty: **{conf['reward_min']}–{conf['reward_max']} 🍩**, "
            f"escape theft **{conf['escape_steal_min']}–{conf['escape_steal_max']} 🍩**",
            f"Undercover officers: **{conf['undercover']}**, show catch time: **{conf['show_time']}**",
            f"Next crook: {next_note}",
        ]
        await ctx.send("\n".join(lines))

    @hunting.command(name="stats", aliases=["record", "me"])
    async def hunting_stats(self, ctx: commands.Context, member: Optional[discord.Member] = None):
        """Your (or someone's) arrest record per crook type."""
        member = member or ctx.author
        data = await self.config.member(member).all()
        total = int(data.get("total", 0))
        embed = discord.Embed(
            title=f"🚔 Arrest record — {member.display_name}",
            color=0x1F8B4C,
        )
        if total == 0:
            embed.description = "No arrests on file yet. Keep an eye out for crooks!"
        else:
            by_crook = data.get("by_crook", {})
            lines = []
            for crook in CROOKS:
                n = int(by_crook.get(crook["id"], 0))
                if n:
                    lines.append(f"{crook['emoji']} {crook_name(crook)} — **{n}**")
            embed.description = "\n".join(lines) or "—"
            embed.set_footer(text=f"Total arrests: {total}")
        await ctx.send(embed=embed)

    @hunting.command(name="board", aliases=["leaderboard", "top"])
    async def hunting_board(self, ctx: commands.Context):
        """Top crook hunters."""
        all_members = await self.config.all_members(ctx.guild)
        rows = sorted(
            ((uid, d.get("total", 0)) for uid, d in all_members.items() if d.get("total", 0) > 0),
            key=lambda kv: kv[1],
            reverse=True,
        )[:25]
        if not rows:
            await ctx.send("Nobody has cuffed a crook yet.")
            return
        medals = ["🥇", "🥈", "🥉"]
        lines = []
        for i, (uid, total) in enumerate(rows):
            m = ctx.guild.get_member(uid)
            name = m.display_name if m else f"Officer {uid}"
            prefix = medals[i] if i < 3 else f"**{i + 1}.**"
            lines.append(f"{prefix} {name} — **{total}**")
        pages = []
        for page in pagify("\n".join(lines), page_length=1000):
            pages.append(
                discord.Embed(title="🏆 Hunting Leaderboard", description=page, color=0x1F8B4C)
            )
        if len(pages) == 1:
            await ctx.send(embed=pages[0])
        else:
            await menu(ctx, pages, DEFAULT_CONTROLS)

    @hunting.command(name="on")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_on(self, ctx: commands.Context):
        """Enable the crook hunt."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await ctx.tick()

    @hunting.command(name="off")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_off(self, ctx: commands.Context):
        """Disable the crook hunt."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.tick()

    @hunting.command(name="add")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_add(self, ctx: commands.Context, channel: discord.TextChannel):
        """Add a hunt channel."""
        async with self.config.guild(ctx.guild).channels() as channels:
            if channel.id not in channels:
                channels.append(channel.id)
        await ctx.tick()

    @hunting.command(name="remove")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_remove(self, ctx: commands.Context, channel: discord.TextChannel):
        """Remove a hunt channel."""
        async with self.config.guild(ctx.guild).channels() as channels:
            if channel.id in channels:
                channels.remove(channel.id)
        await ctx.tick()

    @hunting.command(name="mode")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_mode(self, ctx: commands.Context, mode: str):
        """Catch mode: `words` (shout STOP POLICE) or `reaction` (press 🚨)."""
        mode = mode.lower()
        if mode not in ("words", "reaction"):
            await ctx.send("Pick `words` or `reaction`.")
            return
        await self.config.guild(ctx.guild).mode.set(mode)
        await ctx.tick()

    @hunting.command(name="showtime")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_showtime(self, ctx: commands.Context, value: bool):
        """Show the response time on catches."""
        await self.config.guild(ctx.guild).show_time.set(value)
        await ctx.tick()

    @hunting.command(name="undercover")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_undercover(self, ctx: commands.Context, value: bool):
        """Let undercover officers appear (salute 🫡, don't cuff)."""
        await self.config.guild(ctx.guild).undercover.set(value)
        await ctx.tick()

    @hunting.command(name="rewards")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_rewards(self, ctx: commands.Context, minimum: int, maximum: int):
        """Bounty range per catch, in donuts."""
        if minimum < 0 or maximum > 100_000 or minimum > maximum:
            await ctx.send("Give `min max` with 0 ≤ min ≤ max ≤ 100000.")
            return
        await self.config.guild(ctx.guild).reward_min.set(minimum)
        await self.config.guild(ctx.guild).reward_max.set(maximum)
        await ctx.tick()

    @hunting.command(name="interval")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_interval(self, ctx: commands.Context, minimum: int, maximum: int):
        """Seconds between crooks (min ≥ 60, max ≤ 86400)."""
        if minimum < 60 or maximum > 86_400 or minimum > maximum:
            await ctx.send("Give `min max` with 60 ≤ min ≤ max ≤ 86400.")
            return
        await self.config.guild(ctx.guild).interval_min_s.set(minimum)
        await self.config.guild(ctx.guild).interval_max_s.set(maximum)
        await ctx.tick()

    @hunting.command(name="timeout")
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_timeout(self, ctx: commands.Context, seconds: int):
        """Seconds before an uncaught crook escapes (10-600)."""
        if not 10 <= seconds <= 600:
            await ctx.send("Give a number of seconds between 10 and 600.")
            return
        await self.config.guild(ctx.guild).catch_timeout_s.set(seconds)
        await ctx.tick()

    @hunting.command(name="spawn", aliases=["testspawn"])
    @checks.admin_or_permissions(manage_guild=True)
    async def hunting_spawn(
        self, ctx: commands.Context, channel: Optional[discord.TextChannel] = None
    ):
        """Spawn a crook right now."""
        channel = channel or ctx.channel
        if channel.id in self.active_hunts:
            await ctx.send("There is already a crook loose in that channel.")
            return
        conf = await self.config.guild(ctx.guild).all()
        await self._spawn_crook(channel, conf)

    @hunting.command(name="migratecuff", hidden=True)
    @checks.is_owner()
    async def hunting_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = NODE_DATA_DEFAULT
    ):
        """Migrate hunting scores/config from the Node CuffBot data file."""
        preview = mode.lower() == "preview"
        try:
            data = json.loads(Path(path).read_text())
        except (OSError, json.JSONDecodeError) as exc:
            await ctx.send(f"Could not read the Node data file: `{exc}`")
            return
        report = []
        node_conf = data.get("huntingConfig")
        conf_writes = {}
        if isinstance(node_conf, dict):
            key_map = {
                "enabled": "enabled",
                "channels": "channels",
                "intervalMinS": "interval_min_s",
                "intervalMaxS": "interval_max_s",
                "catchTimeoutS": "catch_timeout_s",
                "mode": "mode",
                "showTime": "show_time",
                "undercover": "undercover",
                "rewardMin": "reward_min",
                "rewardMax": "reward_max",
                "escapeStealMin": "escape_steal_min",
                "escapeStealMax": "escape_steal_max",
            }
            for node_key, red_key in key_map.items():
                if node_key in node_conf:
                    value = node_conf[node_key]
                    if node_key == "channels":
                        value = [int(c) for c in value]
                    conf_writes[red_key] = value
        scores = data.get("huntingScores") or {}
        report.append(f"Config keys to write: {sorted(conf_writes) or 'none (all defaults)'}")
        report.append(f"Score records: {len(scores)}")
        if preview:
            await ctx.send("\n".join(f"[preview] {line}" for line in report))
            return
        for red_key, value in conf_writes.items():
            await self.config.guild(ctx.guild).set_raw(red_key, value=value)
        for user_id, record in scores.items():
            member_conf = self.config.member_from_ids(ctx.guild.id, int(user_id))
            await member_conf.total.set(int(record.get("total", 0)))
            await member_conf.by_crook.set(dict(record.get("byCrook", {})))
        await ctx.send("Migrated: " + "; ".join(report))
