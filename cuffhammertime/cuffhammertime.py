"""CuffHammertime — the precinct clock desk.

Type a natural time phrase — ``in 1 day and 12 hrs``, ``saturday at 6:30pm``,
``now`` — and get Discord ``<t:…>`` timestamps that render correctly for every
reader in their own timezone, in all seven styles with copyable codes. Backed
by a per-member timezone registry with role defaults, a whole-precinct ``list``
view, and an optional auto-convert mode for plain chat messages.

Ported from the CuffBot Node module ``src/modules/hammertime`` (itself a port
of Dumb-Cogs/hammertime). Everything the Node version fixed in code — the
picker timeout, which styles are shown, the footer, the auto-reply shape, the
role-ambiguity rule — is a setting here.

Timezone lookup gained back what the Node port had lost: abbreviations are
indexed for BOTH halves of the year, so `est` finds America/New_York in July
too. See ``zones.py``.
"""

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import discord
from redbot.core import Config, checks, commands

from .parsing import RE_AT_IN, parse_auto_message, parse_phrase
from .timelib import format_users_time, is_valid_timezone, now_ms, offset_minutes_at
from .zones import (
    CANONICAL_ALIASES,
    build_timezone_map,
    describe_zone,
    friendly_name,
    lookup_timezones,
    sort_for_picker,
)

log = logging.getLogger("red.cuff-cogs.cuffhammertime")

LIVE_NODE_JSON = "/home/brand/CuffBot/data/411157175948541954.json"

TEAL = 0x11806A
REMOVE_VALUE = "ht-none"
ALL_STYLES = ["d", "D", "t", "T", "f", "F", "R"]
DEFAULT_AUTO_FORMAT = "-# <t:{ts}:F> (<t:{ts}:R>)"
LIST_DESCRIPTION_LIMIT = 3900


def hammertime_message(
    target_mention: str, users_time: str, ts: int, prefix: str, styles: List[str], footer: bool
) -> str:
    """The cog's output block: each style as a copyable code AND rendered."""
    lines = [
        "**Hammertime!**",
        f"{target_mention}'s **{users_time}** is your",
    ]
    for style in styles:
        lines.append(f"-# `<t:{ts}:{style}>`: <t:{ts}:{style}>")
    if footer:
        lines.append(f"-# Not correct? make sure your timezone is set with `{prefix}ht tz <timezone>`")
    return "\n".join(lines)


def resolve_timezone(
    user_zones: Dict[str, str],
    role_zones: Dict[str, str],
    user_id: int,
    member_role_ids: List[int],
    *,
    strict: bool = True,
) -> Dict[str, Optional[str]]:
    """The cog's ``get_timezone_for``: the member's own setting wins, otherwise
    their roles' timezones.

    The original counts ROLES, not distinct zones, so two timezone roles are
    "ambiguous" even when they name the same zone. That is the ``strict``
    default; turning it off makes agreeing roles resolve instead.
    """
    own = user_zones.get(str(user_id))
    if own:
        return {"zone": own, "error": None}
    hits = [role_zones[str(rid)] for rid in member_role_ids if str(rid) in role_zones]
    if not hits:
        return {"zone": None, "error": "none"}
    if len(hits) > 1 and (strict or len(set(hits)) > 1):
        return {"zone": None, "error": "ambiguous"}
    return {"zone": hits[0], "error": None}


def build_list_groups(
    entries: List[Tuple[Any, str]], epoch_ms: int
) -> List[Dict[str, Any]]:
    """Group members by what their clock reads at that instant, west → east.

    (The cog sorted identical instants against each other — a no-op; sorting by
    offset is the evident intent, fixed in the Node port and kept here.)
    """
    groups: Dict[str, Dict[str, Any]] = {}
    for member, zone in entries:
        formatted = format_users_time(epoch_ms, zone)
        group = groups.setdefault(
            formatted, {"offset": offset_minutes_at(epoch_ms, zone), "members": []}
        )
        group["members"].append(member)
    ordered = sorted(groups.items(), key=lambda item: item[1]["offset"])
    return [
        {
            "formatted": formatted,
            "members": sorted(group["members"], key=lambda m: (getattr(m, "display_name", "") or "").lower()),
        }
        for formatted, group in ordered
    ]


class ZonePicker(discord.ui.View):
    """The disambiguation select for a query that matches several zones.

    Only the officer who ran the command may pick (the cog's interaction
    check); the last row carries the "not listed / remove" escape hatch.
    """

    def __init__(self, cog: "CuffHammertime", owner_id: int, options: List[str], role: Optional[discord.Role], timeout: float):
        super().__init__(timeout=timeout)
        self.cog = cog
        self.owner_id = owner_id
        self.role = role
        self.message: Optional[discord.Message] = None

        capped = sort_for_picker(options)[:119]  # ≤5 rows of 24, plus "remove"
        stamp = now_ms()
        for start in range(0, len(capped), 24):
            chunk = capped[start : start + 24]
            select_options = [
                discord.SelectOption(
                    label=zone[:100],
                    value=zone[:100],
                    # The current local time is what makes this pickable by
                    # someone who does not know one IANA city from another.
                    description=(
                        f"{friendly_name(zone)} · {describe_zone(zone, stamp)}"
                        if friendly_name(zone)
                        else describe_zone(zone, stamp)
                    )[:100],
                )
                for zone in chunk
            ]
            if start + 24 >= len(capped):
                select_options.append(
                    discord.SelectOption(
                        label="My timezone is not listed / Remove my timezone", value=REMOVE_VALUE
                    )
                )
            select = discord.ui.Select(placeholder="Select your timezone", options=select_options)
            select.callback = self._make_callback(select)
            self.add_item(select)

    def _make_callback(self, select: discord.ui.Select):
        async def callback(interaction: discord.Interaction):
            reply = await self.cog.apply_zone_choice(
                guild=interaction.guild,
                user_id=self.owner_id,
                role=self.role,
                zone=select.values[0],
            )
            self.stop()
            await interaction.response.edit_message(content=reply, view=None)

        return callback

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.owner_id:
            await interaction.response.send_message(
                "You are not allowed to use this interaction.", ephemeral=True
            )
            return False
        return True

    async def on_timeout(self) -> None:
        if self.message is not None:
            try:
                await self.message.edit(content="Took too long.", view=None)
            except discord.HTTPException:
                pass


class CuffHammertime(commands.Cog):
    """Natural time phrases → Discord timestamps everyone reads correctly."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175007, force_registration=True)
        self.config.register_guild(
            user_zones={},  # user id (str) -> IANA zone
            role_zones={},  # role id (str) -> IANA zone
            auto_time=False,
            picker_timeout=60,
            styles=list(ALL_STYLES),
            show_footer=True,
            auto_format=DEFAULT_AUTO_FORMAT,
            strict_role_ambiguity=True,
        )
        # The zone index costs a few hundred ms to build on a Pi; do it once,
        # off the event loop, rather than inside the first command.
        self._index_task = asyncio.create_task(self._warm_index())

    async def _warm_index(self) -> None:
        try:
            await self.bot.loop.run_in_executor(None, build_timezone_map)
        except Exception:
            log.warning("Hammertime: building the timezone index failed", exc_info=True)

    def cog_unload(self):
        if self._index_task is not None:
            self._index_task.cancel()

    async def red_delete_data_for_user(self, *, requester, user_id: int):
        """A member's timezone is end-user data — remove it everywhere."""
        for guild in self.bot.guilds:
            async with self.config.guild(guild).user_zones() as zones:
                zones.pop(str(user_id), None)

    # ------------------------------------------------------------------
    # Registry helpers
    # ------------------------------------------------------------------

    async def _resolve(self, guild: discord.Guild, member: discord.Member) -> Dict[str, Optional[str]]:
        conf = await self.config.guild(guild).all()
        return resolve_timezone(
            conf["user_zones"],
            conf["role_zones"],
            member.id,
            [role.id for role in getattr(member, "roles", [])],
            strict=conf["strict_role_ambiguity"],
        )

    async def apply_zone_choice(
        self, *, guild: discord.Guild, user_id: int, role: Optional[discord.Role], zone: str
    ) -> str:
        """Store a confirmed choice (or a removal) for a user or a role."""
        chosen = None if zone == REMOVE_VALUE else zone
        if role is not None:
            async with self.config.guild(guild).role_zones() as zones:
                if chosen is None:
                    zones.pop(str(role.id), None)
                else:
                    zones[str(role.id)] = chosen
            return (
                f"The role **{role.name}**'s timezone is now {chosen}."
                if chosen
                else f"The role **{role.name}**'s timezone has been unset."
            )
        async with self.config.guild(guild).user_zones() as zones:
            if chosen is None:
                zones.pop(str(user_id), None)
            else:
                zones[str(user_id)] = chosen
        if not chosen:
            return "Your timezone has been unset."
        # Name it the way the officer thinks of it, and show the clock so a
        # wrong answer is obvious immediately rather than a week later.
        label = friendly_name(chosen)
        suffix = f" — {label}" if label else ""
        return f"Your timezone is now **{chosen}**{suffix}. It is {describe_zone(chosen)} there now."

    async def _set_zone_flow(self, ctx: commands.Context, query: str, role: Optional[discord.Role]) -> None:
        options = await self.bot.loop.run_in_executor(None, lookup_timezones, query)
        if not options:
            await ctx.send("That is not a valid timezone.")
            return
        if len(options) == 1:
            await ctx.send(
                await self.apply_zone_choice(
                    guild=ctx.guild, user_id=ctx.author.id, role=role, zone=options[0]
                )
            )
            return
        timeout = await self.config.guild(ctx.guild).picker_timeout()
        view = ZonePicker(self, ctx.author.id, options, role, float(timeout))
        view.message = await ctx.send(
            f"`{query}` matches {len(options)} timezones — pick the one showing your own clock:",
            view=view,
        )

    # ------------------------------------------------------------------
    # The group
    # ------------------------------------------------------------------

    @commands.guild_only()
    @commands.group(name="hammertime", aliases=["ht"], invoke_without_command=True)
    async def hammertime(self, ctx: commands.Context, *, phrase: Optional[str] = None):
        """Convert a time phrase into timestamps that render right for everyone.

        `[p]ht in 2 hours`, `[p]ht saturday at 6:30pm`, `[p]ht @officer 5pm`,
        `[p]ht 5pm list`. Bare `[p]ht` shows your settings.
        """
        if phrase is None:
            await self._show_status(ctx)
            return
        await self._convert(ctx, phrase)

    async def _show_status(self, ctx: commands.Context) -> None:
        conf = await self.config.guild(ctx.guild).all()
        zone = conf["user_zones"].get(str(ctx.author.id))
        resolved = await self._resolve(ctx.guild, ctx.author)
        inherited = ""
        if not zone and resolved["zone"]:
            inherited = f" (inherited from a role: {resolved['zone']})"
        lines = [
            f"`{ctx.clean_prefix}ht <phrase>` converts a time in YOUR timezone into Discord timestamps "
            f"every reader sees correctly — try `{ctx.clean_prefix}ht in 1 day and 12 hrs`, "
            f"`{ctx.clean_prefix}ht saturday at 6:30pm`, `{ctx.clean_prefix}ht now`. Put a member first "
            "to read it in THEIRS; add the word `list` to see everyone's local time.",
            "",
            (
                f"**Your timezone:** {zone}"
                if zone
                else f"**Your timezone:** not set{inherited} — "
                f"`{ctx.clean_prefix}ht tz <city, zone or abbreviation>` first."
            ),
            f"**Auto-convert:** "
            + (
                'on — messages with "at 5" / "in 20 min" get a quiet timestamp reply'
                if conf["auto_time"]
                else "off"
            ),
        ]
        await ctx.send("\n".join(lines))

    async def _convert(self, ctx: commands.Context, phrase: str) -> None:
        target = ctx.author
        text = phrase.strip()

        # A leading member reads the phrase in THEIR timezone.
        lead = re.match(r"^(?:<@!?(\d+)>|(\d{15,21}))(?:\s+|$)", text)
        if lead:
            member_id = int(lead.group(1) or lead.group(2))
            member = ctx.guild.get_member(member_id)
            if member is not None:
                target = member
                text = text[lead.end() :]

        list_everyone = re.search(r"\blist\b", text, re.IGNORECASE) is not None
        text = re.sub(r"\blist\b", "", text, flags=re.IGNORECASE).strip() or "now"

        conf = await self.config.guild(ctx.guild).all()
        resolved = await self._resolve(ctx.guild, target)
        pre = "You have" if target.id == ctx.author.id else f"{target.mention} has"
        if resolved["error"] == "none":
            await ctx.send(
                f"{pre} no timezone set. Use `{ctx.clean_prefix}ht tz <timezone>` to set your timezone.",
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return
        if resolved["error"] == "ambiguous":
            await ctx.send(
                f"{pre} multiple timezone roles. Use `{ctx.clean_prefix}ht tz <timezone>` to set your timezone.",
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return

        zone = resolved["zone"]
        parsed = parse_phrase(text, zone, now_ms())
        if parsed is None:
            await ctx.send("I couldn't understand that")
            return

        users_time = format_users_time(parsed["epoch_ms"], zone)
        ts = parsed["epoch_ms"] // 1000
        styles = [style for style in conf["styles"] if style in ALL_STYLES] or list(ALL_STYLES)
        await ctx.send(
            hammertime_message(target.mention, users_time, ts, ctx.clean_prefix, styles, conf["show_footer"]),
            allowed_mentions=discord.AllowedMentions.none(),
        )

        if not list_everyone:
            return
        entries = []
        for member in ctx.guild.members:
            if member.bot:
                continue
            member_zone = resolve_timezone(
                conf["user_zones"],
                conf["role_zones"],
                member.id,
                [role.id for role in member.roles],
                strict=conf["strict_role_ambiguity"],
            )["zone"]
            if member_zone and is_valid_timezone(member_zone):
                entries.append((member, member_zone))
        groups = build_list_groups(entries, parsed["epoch_ms"])
        if not groups:
            await ctx.send("Nobody here has a timezone set yet.")
            return

        description = ""
        for group in groups:
            members = "\n".join(f"-# {member.mention}" for member in group["members"])
            block = f"**{group['formatted']}**\n{'-' * 32}\n{members}\n\n"
            if len(description) + len(block) > LIST_DESCRIPTION_LIMIT:
                description += "…and more."
                break
            description += block
        embed = discord.Embed(
            color=TEAL,
            title=f"@{target.display_name}'s {users_time} is",
            description=description.rstrip(),
        )
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())

    @hammertime.command(name="time", aliases=["for"])
    async def hammertime_time(self, ctx: commands.Context, *, phrase: str):
        """Convert a phrase (optionally for another member: `[p]ht @officer 5pm`)."""
        await self._convert(ctx, phrase)

    @hammertime.command(name="tz", aliases=["timezone"])
    async def hammertime_tz(self, ctx: commands.Context, *, zone: str):
        """Set your timezone.

        US officers can just say `est`, `central`, `pt`, `arizona` — those
        resolve straight away. A city (`new york`), an IANA zone
        (`Europe/Amsterdam`) or an offset (`utc+2`) work too.
        Run `[p]ht zones` for the common list.
        """
        await self._set_zone_flow(ctx, zone, None)

    # NOT aliased to `list`: `[p]ht list` already means "everyone's local time".
    @hammertime.command(name="zones", aliases=["common"])
    async def hammertime_zones(self, ctx: commands.Context):
        """The common timezones and what to type for each."""
        stamp = now_ms()
        seen = []
        for alias, zone in CANONICAL_ALIASES.items():
            if zone not in seen:
                seen.append(zone)
        rows = []
        for zone in seen:
            shorthand = sorted(
                {alias for alias, target in CANONICAL_ALIASES.items() if target == zone and len(alias) <= 8}
            )
            label = friendly_name(zone) or zone
            rows.append(
                f"**{label}** — `{ctx.clean_prefix}ht tz {shorthand[0]}`\n"
                f"-# {zone} · {describe_zone(zone, stamp)} · also: "
                + ", ".join(f"`{alias}`" for alias in shorthand[1:])
            )
        embed = discord.Embed(
            color=TEAL,
            title="⏰ Common timezones",
            description="\n".join(rows),
        )
        embed.set_footer(
            text="Anywhere else: a city (new york), an IANA zone (Europe/Amsterdam) or an offset (utc+2)."
        )
        await ctx.send(embed=embed)

    @hammertime.command(name="role")
    @checks.admin_or_permissions(manage_roles=True)
    async def hammertime_role(self, ctx: commands.Context, role: discord.Role, *, zone: str):
        """Give a role a default timezone — members without their own inherit it."""
        await self._set_zone_flow(ctx, zone, role)

    @hammertime.command(name="auto")
    @checks.admin_or_permissions(manage_guild=True)
    async def hammertime_auto(self, ctx: commands.Context, state: Optional[bool] = None):
        """Toggle auto-converting chat messages containing "at 5" / "in 20 min"."""
        group = self.config.guild(ctx.guild)
        next_state = (not await group.auto_time()) if state is None else state
        await group.auto_time.set(next_state)
        await ctx.send(
            "Time auto-converting is now on." if next_state else "Time auto-converting is now off."
        )

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    @hammertime.command(name="settings")
    @checks.admin_or_permissions(manage_guild=True)
    async def hammertime_settings(self, ctx: commands.Context):
        """Show every Hammertime setting for this server."""
        conf = await self.config.guild(ctx.guild).all()
        role_lines = (
            "\n".join(
                f"  <@&{role_id}> → {zone}" for role_id, zone in sorted(conf["role_zones"].items())
            )
            or "  none"
        )
        lines = [
            "⏰ **Hammertime settings**",
            f"**Auto-convert:** {'on' if conf['auto_time'] else 'off'}",
            f"**Auto reply format:** `{conf['auto_format']}`",
            f"**Styles shown:** {' '.join(conf['styles'])}",
            f"**Footer:** {'shown' if conf['show_footer'] else 'hidden'}",
            f"**Picker timeout:** {conf['picker_timeout']}s",
            f"**Role ambiguity:** {'strict (any two timezone roles clash)' if conf['strict_role_ambiguity'] else 'lenient (only differing zones clash)'}",
            f"**Members with a timezone:** {len(conf['user_zones'])}",
            "**Role timezones:**",
            role_lines,
        ]
        await ctx.send("\n".join(lines), allowed_mentions=discord.AllowedMentions.none())

    @hammertime.command(name="styles")
    @checks.admin_or_permissions(manage_guild=True)
    async def hammertime_styles(self, ctx: commands.Context, *, styles: Optional[str] = None):
        """Which timestamp styles the output shows, e.g. `F R`. No argument = all seven."""
        group = self.config.guild(ctx.guild)
        if styles is None:
            await group.styles.set(list(ALL_STYLES))
            await ctx.send(f"✅ Showing all seven styles: {' '.join(ALL_STYLES)}")
            return
        picked = [token for token in styles.replace(",", " ").split() if token]
        unknown = [token for token in picked if token not in ALL_STYLES]
        if unknown or not picked:
            await ctx.send(
                f"🚫 Unknown style(s): {', '.join(f'`{u}`' for u in unknown) or '(none given)'}. "
                f"Valid styles: {' '.join(f'`{s}`' for s in ALL_STYLES)}."
            )
            return
        ordered = [style for style in ALL_STYLES if style in picked]
        await group.styles.set(ordered)
        await ctx.send(f"✅ Showing: {' '.join(ordered)}")

    @hammertime.command(name="footer")
    @checks.admin_or_permissions(manage_guild=True)
    async def hammertime_footer(self, ctx: commands.Context, on_off: bool):
        """Show or hide the "set your timezone" footer line."""
        await self.config.guild(ctx.guild).show_footer.set(on_off)
        await ctx.send("✅ Footer shown." if on_off else "✅ Footer hidden.")

    @hammertime.command(name="timeout")
    @checks.admin_or_permissions(manage_guild=True)
    async def hammertime_timeout(self, ctx: commands.Context, seconds: int):
        """How long a timezone picker stays usable (10–300 s).

        The original cog used 10 s, which was punishingly short; 60 is the default.
        """
        if seconds < 10 or seconds > 300:
            await ctx.send("🚫 Pick between **10** and **300** seconds.")
            return
        await self.config.guild(ctx.guild).picker_timeout.set(seconds)
        await ctx.send(f"✅ Pickers stay open for **{seconds}s**.")

    @hammertime.command(name="autoformat")
    @checks.admin_or_permissions(manage_guild=True)
    async def hammertime_autoformat(self, ctx: commands.Context, *, template: Optional[str] = None):
        """Auto-convert reply text. Use `{ts}` for the timestamp. No text = show it."""
        group = self.config.guild(ctx.guild)
        if template is None:
            current = await group.auto_format()
            await ctx.send(
                f"Current auto reply:\n```\n{current}\n```\n"
                f"Reset with `{ctx.clean_prefix}ht autoformat default`."
            )
            return
        if template.strip().lower() == "default":
            await group.auto_format.set(DEFAULT_AUTO_FORMAT)
            await ctx.send("✅ Auto reply reset to the default.")
            return
        if "{ts}" not in template:
            await ctx.send("🚫 The template needs `{ts}` — otherwise there is no timestamp in it.")
            return
        await group.auto_format.set(template)
        await ctx.send(f"✅ Auto reply set. Preview:\n{template.format(ts=now_ms() // 1000)}")

    @hammertime.command(name="ambiguity")
    @checks.admin_or_permissions(manage_guild=True)
    async def hammertime_ambiguity(self, ctx: commands.Context, strict: bool):
        """Strict (the cog's rule: any two timezone roles clash) or lenient."""
        await self.config.guild(ctx.guild).strict_role_ambiguity.set(strict)
        await ctx.send(
            "✅ Any two timezone roles are ambiguous (the original cog's rule)."
            if strict
            else "✅ Two timezone roles naming the SAME zone now resolve instead of clashing."
        )

    @hammertime.command(name="forget")
    @checks.admin_or_permissions(manage_guild=True)
    async def hammertime_forget(self, ctx: commands.Context, member: discord.Member):
        """Remove someone else's stored timezone."""
        async with self.config.guild(ctx.guild).user_zones() as zones:
            existed = zones.pop(str(member.id), None)
        await ctx.send(
            f"🗑️ Removed the timezone for **{member.display_name}** (was {existed})."
            if existed
            else f"ℹ️ **{member.display_name}** had no timezone set."
        )

    @hammertime.command(name="migratecuff")
    @checks.is_owner()
    async def hammertime_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = LIVE_NODE_JSON
    ):
        """Migrate the timezone registry from the CuffBot Node data file.

        `mode` is `preview` (show what would be written) or `apply` (default).
        Only keys present in the Node JSON are written. Safe to run twice.
        """
        mode = mode.lower()
        if mode not in ("preview", "apply"):
            await ctx.send(
                f"🚫 Unknown mode `{mode}`. Use `{ctx.clean_prefix}ht migratecuff preview` "
                f"or `{ctx.clean_prefix}ht migratecuff apply`."
            )
            return
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            await ctx.send(f"🚫 Could not read the Node data file at `{path}`: {error}")
            return

        changes: Dict[str, Any] = {}
        users = data.get("hammertimeUsers")
        if isinstance(users, dict) and users:
            kept = {str(uid): zone for uid, zone in users.items() if is_valid_timezone(zone)}
            if kept:
                changes["user_zones"] = kept
        roles = data.get("hammertimeRoles")
        if isinstance(roles, dict) and roles:
            kept_roles = {str(rid): zone for rid, zone in roles.items() if is_valid_timezone(zone)}
            if kept_roles:
                changes["role_zones"] = kept_roles
        node_config = data.get("hammertimeConfig")
        if isinstance(node_config, dict) and "autoTime" in node_config:
            changes["auto_time"] = bool(node_config["autoTime"])

        if not changes:
            await ctx.send("Nothing to migrate: the Node data file has no hammertime keys.")
            return

        summary = "\n".join(
            f"{key} = {value if not isinstance(value, (list, dict)) else f'<{len(value)} entries>'}"
            for key, value in changes.items()
        )
        if mode == "preview":
            await ctx.send(f"**Hammertime migration preview** (nothing written):\n```\n{summary}\n```")
            return

        group = self.config.guild(ctx.guild)
        for key, value in changes.items():
            await group.get_attr(key).set(value)
        await ctx.send(f"✅ Migrated from `{path}`:\n```\n{summary}\n```")

    # ------------------------------------------------------------------
    # Auto-convert listener
    # ------------------------------------------------------------------

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        try:
            await self._auto_convert(message)
        except Exception:
            # A chat message must never crash the gateway handler.
            log.warning("Hammertime: auto-convert failed", exc_info=True)

    async def _auto_convert(self, message: discord.Message) -> None:
        if message.author.bot or message.guild is None:
            return
        content = message.content or ""
        # Cheapest possible gate FIRST: the parser needs "at <digit>" or
        # "in <digit>" to fire at all, and this listener sees every message in
        # the server — a Config read per chat line is not worth paying.
        if not RE_AT_IN.search(content.lower()):
            return
        conf = await self.config.guild(message.guild).all()
        if not conf["auto_time"]:
            return
        # Never fire on our own invocations.
        prefixes = await self.bot.get_valid_prefixes(message.guild)
        stripped = content.strip().lower()
        for prefix in prefixes:
            lowered = prefix.lower()
            if stripped.startswith(f"{lowered}ht") or stripped.startswith(f"{lowered}hammertime"):
                return

        member = message.author
        resolved = resolve_timezone(
            conf["user_zones"],
            conf["role_zones"],
            member.id,
            [role.id for role in getattr(member, "roles", [])],
            strict=conf["strict_role_ambiguity"],
        )
        if resolved["error"] or not resolved["zone"]:
            return

        epoch_ms = parse_auto_message(content, resolved["zone"], now_ms())
        if epoch_ms is None:
            return
        try:
            reply = conf["auto_format"].format(ts=epoch_ms // 1000)
        except (KeyError, IndexError, ValueError):
            reply = DEFAULT_AUTO_FORMAT.format(ts=epoch_ms // 1000)
        try:
            await message.reply(reply, mention_author=False)
        except discord.HTTPException:
            pass
