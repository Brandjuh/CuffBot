"""CuffLevels — XP/leveling with promote-only rank-role sync.

Port of the Node CuffBot leveling + academy-ladder modules. The rank ladder
is not a fixed chain: it is the server's own rank roles, detected under a
pinned header role (ordered highest first, ending at the next section
divider). Role sync only ever promotes — demotions stay a human decision.
"""

import asyncio
import json
import logging
import math
import re
import time
from pathlib import Path
from typing import Literal, Optional

import discord
from discord.ext import tasks
from redbot.core import Config, checks, commands
from redbot.core.bot import Red
from redbot.core.utils.chat_formatting import pagify
from redbot.core.utils.menus import DEFAULT_CONTROLS, menu

log = logging.getLogger("red.cuffcogs.cufflevels")

NODE_DATA_DEFAULT = "/home/brand/CuffBot/data/411157175948541954.json"

DEFAULT_GUILD = {
    "enabled": True,
    "sync_roles": True,
    "announce_channel_id": None,
    "message_xp": 15,
    "message_cooldown_ms": 60_000,
    "voice_xp_per_min": 1,
    "base_xp": 1000,
    "exponent": 1.8,
    "header_role_id": None,
    "excluded_role_ids": [],
    "ladder_snapshot": [],  # role ids, highest rank first
}

DEFAULT_MEMBER = {"xp": 0, "last_message_at": 0, "seeded_from_rank": None}

RECONCILE_DEBOUNCE_S = 15
ROLE_WRITE_SPACING_S = 0.4
ROLE_WRITE_CAP = 300

SECTION_DIVIDER_BRACKET_RE = re.compile(r"^[\s\W]*\[[^\]]+\][\s\W]*$")
SECTION_DIVIDER_LINE_RE = re.compile(r"[▬━─═_=~-]{2,}")
HEADER_HINT_RE = re.compile(r"level|rank", re.IGNORECASE)


# ------------------------------------------------------------------ #
# Pure ladder / XP math (ported 1:1 from Node lib/ladder.js + xp.js)  #
# ------------------------------------------------------------------ #

def is_section_divider(name: str) -> bool:
    if not isinstance(name, str):
        return False
    return bool(
        SECTION_DIVIDER_BRACKET_RE.match(name)
        or SECTION_DIVIDER_LINE_RE.search(name.replace(" ", ""))
    )


def looks_like_header(name: str) -> bool:
    return isinstance(name, str) and bool(HEADER_HINT_RE.search(name))


def thresholds_for(rank_count: int, base_xp: int, exponent: float) -> list[int]:
    """Lowest rank first. JS Math.round is half-up — Python round() is not."""
    return [
        math.floor(base_xp * (i + 1) ** exponent + 0.5) for i in range(rank_count)
    ]


def achieved_ranks(xp: int, thresholds: list[int]) -> int:
    achieved = 0
    for t in thresholds:
        if xp >= t:
            achieved += 1
        else:
            break
    return achieved


def target_rank_index(xp: int, thresholds: list[int]) -> Optional[int]:
    """Index into the highest-first ladder (0 = top rank), or None for unranked."""
    achieved = achieved_ranks(xp, thresholds)
    if achieved == 0:
        return None
    return len(thresholds) - achieved


def seed_xp_for_rank_index(rank_index: int, thresholds: list[int]) -> int:
    """XP floor for a held rank (rank_index 0 = top)."""
    count = len(thresholds)
    if rank_index < 0 or rank_index >= count:
        return 0
    from_bottom = count - rank_index
    return thresholds[from_bottom - 1]


def level_progress(xp: int, thresholds: list[int]) -> dict:
    achieved = achieved_ranks(xp, thresholds)
    current_floor = 0 if achieved == 0 else thresholds[achieved - 1]
    next_threshold = thresholds[achieved] if achieved < len(thresholds) else None
    return {
        "achieved": achieved,
        "current_floor": current_floor,
        "next_threshold": next_threshold,
        "xp_into_rank": xp - current_floor,
        "xp_for_next": (next_threshold - xp) if next_threshold is not None else None,
    }


class CuffLevels(commands.Cog):
    """XP for chat and voice activity, with automatic promote-only rank roles."""

    def __init__(self, bot: Red):
        super().__init__()
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175001, force_registration=True)
        self.config.register_guild(**DEFAULT_GUILD)
        self.config.register_member(**DEFAULT_MEMBER)
        self._in_flight: set[tuple[int, int]] = set()  # (guild_id, member_id) promo guard
        self._reconcile_tasks: dict[int, asyncio.Task] = {}
        self.voice_sweep.start()

    def cog_unload(self):
        self.voice_sweep.cancel()
        for task in self._reconcile_tasks.values():
            task.cancel()
        self._reconcile_tasks.clear()

    async def red_delete_data_for_user(
        self,
        *,
        requester: Literal["discord_deleted_user", "owner", "user", "user_strict"],
        user_id: int,
    ):
        all_members = await self.config.all_members()
        for guild_id in all_members:
            await self.config.member_from_ids(guild_id, user_id).clear()

    # --------------------------------------------------------------- #
    # Ladder                                                            #
    # --------------------------------------------------------------- #

    def build_ladder(self, guild: discord.Guild, conf: dict) -> list[discord.Role]:
        """Rank roles ordered highest first; empty list when no header is found."""
        roles_desc = sorted(guild.roles, key=lambda r: r.position, reverse=True)
        excluded = set(conf["excluded_role_ids"])
        header_idx = -1
        if conf["header_role_id"]:
            for i, role in enumerate(roles_desc):
                if role.id == conf["header_role_id"]:
                    header_idx = i
                    break
        if header_idx < 0:
            for i, role in enumerate(roles_desc):
                if looks_like_header(role.name):
                    header_idx = i
                    break
        if header_idx < 0:
            return []
        ranks: list[discord.Role] = []
        for role in roles_desc[header_idx + 1:]:
            if role.is_default() or role.managed or role.id in excluded:
                continue
            if is_section_divider(role.name):
                break
            ranks.append(role)
        return ranks

    def is_pinned(self, guild: discord.Guild, conf: dict) -> bool:
        return bool(conf["header_role_id"]) and guild.get_role(conf["header_role_id"]) is not None

    def current_rank_index_of(self, member: discord.Member, ladder: list[discord.Role]) -> int:
        held = {r.id for r in member.roles}
        for i, role in enumerate(ladder):
            if role.id in held:
                return i
        return -1

    async def current_rank_name(self, member: discord.Member) -> Optional[str]:
        """Public seam for the CuffAffairs badge command."""
        conf = await self.config.guild(member.guild).all()
        ladder = self.build_ladder(member.guild, conf)
        idx = self.current_rank_index_of(member, ladder)
        return ladder[idx].name if idx >= 0 else None

    # --------------------------------------------------------------- #
    # XP awarding                                                       #
    # --------------------------------------------------------------- #

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or message.guild is None or message.is_system():
            return
        if await self.bot.cog_disabled_in_guild(self, message.guild):
            return
        conf = await self.config.guild(message.guild).all()
        if not conf["enabled"]:
            return
        member_conf = self.config.member(message.author)
        data = await member_conf.all()
        now_ms = int(time.time() * 1000)
        # Read-only fast path inside the cooldown: no config write.
        if data["last_message_at"] and now_ms - data["last_message_at"] < conf["message_cooldown_ms"]:
            return
        new_xp = int(data["xp"]) + conf["message_xp"]
        await member_conf.xp.set(new_xp)
        await member_conf.last_message_at.set(now_ms)
        await self._maybe_promote(
            message.author, int(data["xp"]), new_xp, conf, fallback_channel=message.channel
        )

    @tasks.loop(seconds=60)
    async def voice_sweep(self):
        for guild in self.bot.guilds:
            try:
                if await self.bot.cog_disabled_in_guild(self, guild):
                    continue
                conf = await self.config.guild(guild).all()
                if not conf["enabled"] or conf["voice_xp_per_min"] <= 0:
                    continue
                for channel in guild.voice_channels:
                    if guild.afk_channel and channel.id == guild.afk_channel.id:
                        continue
                    humans = [m for m in channel.members if not m.bot]
                    if len(humans) < 2:
                        continue  # anti solo-farm
                    for member in humans:
                        if member.voice and member.voice.self_deaf:
                            continue
                        member_conf = self.config.member(member)
                        old_xp = await member_conf.xp()
                        new_xp = int(old_xp) + conf["voice_xp_per_min"]
                        await member_conf.xp.set(new_xp)
                        # Voice promotions are silent unless an announce channel is set.
                        await self._maybe_promote(member, int(old_xp), new_xp, conf, fallback_channel=None)
            except Exception:
                log.exception("Voice XP sweep failed for guild %s", guild.id)

    @voice_sweep.before_loop
    async def _before_voice_sweep(self):
        await self.bot.wait_until_ready()

    # --------------------------------------------------------------- #
    # Promotion / role sync                                             #
    # --------------------------------------------------------------- #

    async def _maybe_promote(
        self,
        member: discord.Member,
        old_xp: int,
        new_xp: int,
        conf: dict,
        fallback_channel: Optional[discord.abc.Messageable],
    ):
        ladder = self.build_ladder(member.guild, conf)
        if not ladder:
            return
        thresholds = thresholds_for(len(ladder), conf["base_xp"], conf["exponent"])
        old_achieved = achieved_ranks(old_xp, thresholds)
        new_achieved = achieved_ranks(new_xp, thresholds)
        if new_achieved <= old_achieved:
            return
        key = (member.guild.id, member.id)
        if key in self._in_flight:
            return
        self._in_flight.add(key)
        try:
            target_idx = target_rank_index(new_xp, thresholds)
            if target_idx is None:
                return
            from_idx = self.current_rank_index_of(member, ladder)
            from_name = ladder[from_idx].name if from_idx >= 0 else None
            applied = await self._sync_member_roles(member, ladder, target_idx, conf)
            to_name = ladder[target_idx].name
            if applied or not conf["sync_roles"]:
                await self._announce_rank_up(member, from_name, to_name, conf, fallback_channel)
        finally:
            self._in_flight.discard(key)

    async def _sync_member_roles(
        self,
        member: discord.Member,
        ladder: list[discord.Role],
        target_idx: int,
        conf: dict,
    ) -> bool:
        """Promote-only: never move a member down the ladder. Returns True when changed."""
        if not conf["sync_roles"] or not self.is_pinned(member.guild, conf):
            return False
        target_role = ladder[target_idx]
        if not target_role.is_assignable():
            return False
        current_idx = self.current_rank_index_of(member, ladder)
        # Lower index = higher rank; an equal-or-higher held rank is a no-op.
        if current_idx != -1 and current_idx <= target_idx:
            return False
        held_ladder = [r for r in ladder if r in member.roles and r.id != target_role.id]
        reason = f"CuffLevels promotion to {target_role.name}"
        try:
            if held_ladder:
                await member.remove_roles(*held_ladder, reason=reason)
            await member.add_roles(target_role, reason=reason)
            return True
        except (discord.Forbidden, discord.HTTPException):
            log.warning("Role sync failed for %s in %s", member.id, member.guild.id)
            return False

    async def _announce_rank_up(
        self,
        member: discord.Member,
        from_name: Optional[str],
        to_name: str,
        conf: dict,
        fallback_channel: Optional[discord.abc.Messageable],
    ):
        channel = None
        if conf["announce_channel_id"]:
            channel = member.guild.get_channel(conf["announce_channel_id"])
        if channel is None:
            channel = fallback_channel
        if channel is None:
            return  # voice promotions stay silent without a configured channel
        if from_name is None:
            text = (
                f"🎖️ **{member.display_name}** earned their first stripes: "
                f"**{to_name}**! Welcome to the force."
            )
        else:
            text = (
                f"🎖️ **{member.display_name}** earned a promotion: "
                f"**{from_name}** → **{to_name}**! Congratulations, officer."
            )
        try:
            await channel.send(text)
        except (discord.Forbidden, discord.HTTPException):
            pass

    # --------------------------------------------------------------- #
    # Ladder reconciliation (debounced, silent, promote-only)           #
    # --------------------------------------------------------------- #

    @commands.Cog.listener()
    async def on_guild_role_create(self, role: discord.Role):
        self._schedule_reconcile(role.guild)

    @commands.Cog.listener()
    async def on_guild_role_delete(self, role: discord.Role):
        self._schedule_reconcile(role.guild)

    @commands.Cog.listener()
    async def on_guild_role_update(self, before: discord.Role, after: discord.Role):
        if before.position != after.position:
            self._schedule_reconcile(after.guild)

    def _schedule_reconcile(self, guild: discord.Guild):
        existing = self._reconcile_tasks.get(guild.id)
        if existing and not existing.done():
            existing.cancel()
        self._reconcile_tasks[guild.id] = asyncio.create_task(self._debounced_reconcile(guild))

    async def _debounced_reconcile(self, guild: discord.Guild):
        try:
            await asyncio.sleep(RECONCILE_DEBOUNCE_S)
            await self._reconcile_ladder(guild)
        except asyncio.CancelledError:
            pass
        except Exception:
            log.exception("Ladder reconcile failed for guild %s", guild.id)

    async def _reconcile_ladder(self, guild: discord.Guild):
        conf = await self.config.guild(guild).all()
        if not conf["enabled"] or not self.is_pinned(guild, conf):
            return
        ladder = self.build_ladder(guild, conf)
        snapshot = [r.id for r in ladder]
        if snapshot == conf["ladder_snapshot"]:
            return  # renames are free; only structure changes trigger a sweep
        first_sight = not conf["ladder_snapshot"]
        await self.config.guild(guild).ladder_snapshot.set(snapshot)
        if not ladder:
            return
        thresholds = thresholds_for(len(ladder), conf["base_xp"], conf["exponent"])
        writes = 0
        for member in guild.members:
            if member.bot:
                continue
            held_idx = self.current_rank_index_of(member, ladder)
            member_conf = self.config.member(member)
            data = await member_conf.all()
            xp = int(data["xp"])
            # Self-healing: raise XP to the floor of a held rank (never lowers).
            if held_idx >= 0:
                floor_xp = seed_xp_for_rank_index(held_idx, thresholds)
                if xp < floor_xp:
                    xp = floor_xp
                    await member_conf.xp.set(xp)
                    if first_sight:
                        await member_conf.seeded_from_rank.set(ladder[held_idx].name)
            if not conf["sync_roles"]:
                continue
            target_idx = target_rank_index(xp, thresholds)
            if target_idx is None:
                continue
            if held_idx != -1 and held_idx <= target_idx:
                continue
            if writes >= ROLE_WRITE_CAP:
                log.warning("Reconcile role-write cap reached in guild %s", guild.id)
                break
            changed = await self._sync_member_roles(member, ladder, target_idx, conf)
            if changed:
                writes += 1
                await asyncio.sleep(ROLE_WRITE_SPACING_S)

    # --------------------------------------------------------------- #
    # Commands                                                          #
    # --------------------------------------------------------------- #

    @commands.command(name="level")
    @commands.guild_only()
    async def level(self, ctx: commands.Context, member: Optional[discord.Member] = None):
        """Your (or someone's) service record: XP, rank and progress."""
        member = member or ctx.author
        if member.bot:
            await ctx.send("Bots don't climb the ladder — they hold it steady.")
            return
        conf = await self.config.guild(ctx.guild).all()
        ladder = self.build_ladder(ctx.guild, conf)
        xp = int(await self.config.member(member).xp())
        embed = discord.Embed(title=f"📈 Service record — {member.display_name}", color=0x2E86DE)
        embed.set_thumbnail(url=member.display_avatar.url)
        rank_idx = self.current_rank_index_of(member, ladder)
        rank_name = ladder[rank_idx].name if rank_idx >= 0 else "Unranked"
        embed.add_field(name="Rank", value=rank_name, inline=True)
        embed.add_field(name="XP", value=f"{xp:,}", inline=True)
        if ladder:
            thresholds = thresholds_for(len(ladder), conf["base_xp"], conf["exponent"])
            prog = level_progress(xp, thresholds)
            if prog["next_threshold"] is not None:
                embed.add_field(
                    name="Next rank",
                    value=f"{prog['xp_for_next']:,} XP to go "
                    f"({xp:,}/{prog['next_threshold']:,})",
                    inline=False,
                )
            else:
                embed.add_field(name="Next rank", value="Top of the ladder. 🎖️", inline=False)
        await ctx.send(embed=embed)

    @commands.command(name="levels", aliases=["xplb"])
    @commands.guild_only()
    async def levels(self, ctx: commands.Context, size: int = 10):
        """The precinct XP leaderboard."""
        size = max(1, min(25, size))
        all_members = await self.config.all_members(ctx.guild)
        rows = sorted(
            ((uid, int(d.get("xp", 0))) for uid, d in all_members.items() if d.get("xp", 0) > 0),
            key=lambda kv: kv[1],
            reverse=True,
        )[:size]
        if not rows:
            await ctx.send("Nobody has earned XP yet.")
            return
        medals = ["🥇", "🥈", "🥉"]
        lines = []
        for i, (uid, xp) in enumerate(rows):
            m = ctx.guild.get_member(uid)
            name = m.display_name if m else f"Officer {uid}"
            prefix = medals[i] if i < 3 else f"**{i + 1}.**"
            lines.append(f"{prefix} {name} — **{xp:,} XP**")
        embed = discord.Embed(
            title="📈 Precinct Leaderboard", description="\n".join(lines), color=0xD4A24E
        )
        await ctx.send(embed=embed)

    @commands.group(name="xp", aliases=["xpconfig"], invoke_without_command=True)
    @commands.guild_only()
    async def xp(self, ctx: commands.Context):
        """XP system configuration."""
        if not ctx.author.guild_permissions.manage_guild:
            await ctx.send(f"See `{ctx.clean_prefix}xp ladder` for the rank thresholds.")
            return
        conf = await self.config.guild(ctx.guild).all()
        ladder = self.build_ladder(ctx.guild, conf)
        header = ctx.guild.get_role(conf["header_role_id"]) if conf["header_role_id"] else None
        announce = (
            f"<#{conf['announce_channel_id']}>" if conf["announce_channel_id"] else "message channel"
        )
        lines = [
            f"Enabled: **{conf['enabled']}**, role sync: **{conf['sync_roles']}**",
            f"Message XP: **{conf['message_xp']}** per message, cooldown "
            f"**{conf['message_cooldown_ms'] // 1000} s**",
            f"Voice XP: **{conf['voice_xp_per_min']}/min**",
            f"Curve: rank N needs `floor({conf['base_xp']} · N^{conf['exponent']})` XP",
            f"Announce channel: {announce}",
            f"Ladder header: {header.mention if header else '*not pinned*'} — "
            f"**{len(ladder)}** rank roles detected",
        ]
        await ctx.send("\n".join(lines), allowed_mentions=discord.AllowedMentions.none())

    @xp.command(name="ladder", aliases=["ranks", "thresholds"])
    async def xp_ladder(self, ctx: commands.Context):
        """Which XP total earns which rank."""
        conf = await self.config.guild(ctx.guild).all()
        ladder = self.build_ladder(ctx.guild, conf)
        if not ladder:
            await ctx.send(
                "No rank ladder detected. Pin the header role with "
                f"`{ctx.clean_prefix}xp header <@role>`."
            )
            return
        thresholds = thresholds_for(len(ladder), conf["base_xp"], conf["exponent"])
        my_xp = int(await self.config.member(ctx.author).xp())
        achieved = achieved_ranks(my_xp, thresholds)
        lines = []
        # ladder is highest-first; thresholds are lowest-first.
        for from_bottom, threshold in enumerate(thresholds, start=1):
            role = ladder[len(ladder) - from_bottom]
            marker = ""
            if achieved == from_bottom:
                marker = f" ⬅️ you ({my_xp:,} XP)"
            lines.append(f"**{threshold:,} XP** — {role.name}{marker}")
        description = "\n".join(lines)[:4000]
        embed = discord.Embed(title="🎖️ Rank ladder", description=description, color=0xD4A24E)
        await ctx.send(embed=embed)

    @xp.command(name="on")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_on(self, ctx: commands.Context):
        """Enable the XP system."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await ctx.tick()

    @xp.command(name="off")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_off(self, ctx: commands.Context):
        """Disable the XP system."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.tick()

    @xp.command(name="sync")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_sync(self, ctx: commands.Context, value: bool):
        """Auto-assign rank roles when XP earns them."""
        await self.config.guild(ctx.guild).sync_roles.set(value)
        await ctx.tick()

    @xp.command(name="message")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_message(self, ctx: commands.Context, amount: int):
        """XP per message (1-100)."""
        if not 1 <= amount <= 100:
            await ctx.send("Give a number between 1 and 100.")
            return
        await self.config.guild(ctx.guild).message_xp.set(amount)
        await ctx.tick()

    @xp.command(name="voice")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_voice(self, ctx: commands.Context, amount: int):
        """XP per minute in voice (1-100)."""
        if not 1 <= amount <= 100:
            await ctx.send("Give a number between 1 and 100.")
            return
        await self.config.guild(ctx.guild).voice_xp_per_min.set(amount)
        await ctx.tick()

    @xp.command(name="cooldown")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_cooldown(self, ctx: commands.Context, seconds: int):
        """Seconds between message-XP awards (10-600)."""
        if not 10 <= seconds <= 600:
            await ctx.send("Give a number of seconds between 10 and 600.")
            return
        await self.config.guild(ctx.guild).message_cooldown_ms.set(seconds * 1000)
        await ctx.tick()

    @xp.command(name="announce")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_announce(self, ctx: commands.Context, channel: discord.TextChannel):
        """Channel for promotion announcements."""
        await self.config.guild(ctx.guild).announce_channel_id.set(channel.id)
        await ctx.tick()

    @xp.command(name="noannounce", aliases=["clearannounce"])
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_noannounce(self, ctx: commands.Context):
        """Announce promotions in the channel where they happen."""
        await self.config.guild(ctx.guild).announce_channel_id.set(None)
        await ctx.tick()

    @xp.command(name="base")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_base(self, ctx: commands.Context, amount: int):
        """XP the lowest rank costs (50-100000); all thresholds scale from it."""
        if not 50 <= amount <= 100_000:
            await ctx.send("Give a number between 50 and 100000.")
            return
        await self.config.guild(ctx.guild).base_xp.set(amount)
        await ctx.tick()

    @xp.command(name="exponent")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_exponent(self, ctx: commands.Context, value: float):
        """Curve steepness (1.0-3.0): rank N = base · N^exponent."""
        if not 1.0 <= value <= 3.0:
            await ctx.send("Give a number between 1.0 and 3.0.")
            return
        await self.config.guild(ctx.guild).exponent.set(value)
        await ctx.tick()

    @xp.command(name="header")
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_header(self, ctx: commands.Context, role: discord.Role):
        """Pin the header role the rank roles sit under."""
        await self.config.guild(ctx.guild).header_role_id.set(role.id)
        self._schedule_reconcile(ctx.guild)
        await ctx.tick()

    @xp.command(name="exclude", aliases=["ignore"])
    @checks.admin_or_permissions(manage_guild=True)
    async def xp_exclude(self, ctx: commands.Context, role: discord.Role):
        """Toggle a role out of / back into the ladder."""
        async with self.config.guild(ctx.guild).excluded_role_ids() as excluded:
            if role.id in excluded:
                excluded.remove(role.id)
                verb = "back in the ladder"
            else:
                excluded.append(role.id)
                verb = "excluded from the ladder"
        self._schedule_reconcile(ctx.guild)
        await ctx.send(f"**{role.name}** is now {verb}.")

    @xp.command(name="migratecuff", hidden=True)
    @checks.is_owner()
    async def xp_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = NODE_DATA_DEFAULT
    ):
        """Migrate XP users + ladder pin from the Node CuffBot data file."""
        preview = mode.lower() == "preview"
        try:
            data = json.loads(Path(path).read_text())
        except (OSError, json.JSONDecodeError) as exc:
            await ctx.send(f"Could not read the Node data file: `{exc}`")
            return
        report = []
        xp_users = data.get("xpUsers") or {}
        academy = data.get("academyConfig") or {}
        snapshot = (data.get("ladderSnapshot") or {}).get("roleIds") or []
        xp_conf = data.get("xpConfig") or {}
        key_map = {
            "enabled": "enabled",
            "syncRoles": "sync_roles",
            "announceChannelId": "announce_channel_id",
            "messageXp": "message_xp",
            "messageCooldownMs": "message_cooldown_ms",
            "voiceXpPerMin": "voice_xp_per_min",
            "baseXp": "base_xp",
            "exponent": "exponent",
        }
        conf_writes = {}
        for node_key, red_key in key_map.items():
            if node_key in xp_conf:
                value = xp_conf[node_key]
                if node_key == "announceChannelId" and value is not None:
                    value = int(value)
                conf_writes[red_key] = value
        report.append(f"XP records: {len(xp_users)}")
        report.append(f"Config keys to write: {sorted(conf_writes) or 'none (all defaults)'}")
        report.append(
            "Ladder pin: header={h}, excluded={e}, snapshot={s} roles".format(
                h=academy.get("headerRoleId", "—"),
                e=len(academy.get("excludedRoleIds") or []),
                s=len(snapshot),
            )
        )
        if preview:
            await ctx.send("\n".join(f"[preview] {line}" for line in report))
            return
        for red_key, value in conf_writes.items():
            await self.config.guild(ctx.guild).set_raw(red_key, value=value)
        if "headerRoleId" in academy and academy["headerRoleId"]:
            await self.config.guild(ctx.guild).header_role_id.set(int(academy["headerRoleId"]))
        if "excludedRoleIds" in academy:
            await self.config.guild(ctx.guild).excluded_role_ids.set(
                [int(r) for r in academy["excludedRoleIds"] or []]
            )
        if snapshot:
            await self.config.guild(ctx.guild).ladder_snapshot.set([int(r) for r in snapshot])
        for user_id, record in xp_users.items():
            member_conf = self.config.member_from_ids(ctx.guild.id, int(user_id))
            await member_conf.xp.set(int(record.get("xp", 0)))
            await member_conf.last_message_at.set(int(record.get("lastMessageAt") or 0))
            if record.get("seededFromRank") is not None:
                await member_conf.seeded_from_rank.set(record["seededFromRank"])
        await ctx.send("Migrated: " + "; ".join(report))
