"""CuffBirthday — the precinct birthday watch.

Members register their birthday once (their own timezone supported) and the
precinct celebrates them in the configured channel, on THEIR own calendar day,
once a year. Celebrants wear a birthday role for their whole local day.

Ported from the CuffBot Node module ``src/modules/birthdays`` — the calendar
rules (Feb 29, the local-day sweep, the once-per-year stamp, the never-strip-a
-manual-role guarantee) and the strings are kept faithful. Everything the Node
version hard-coded as "owner decision" product config is a setting here, which
is the point of the port.

There is no midnight job to miss: a sweep runs every ``sweep_minutes`` and asks
"has anyone's birthday started in their own timezone?", so a Pi that reboots at
00:05 still announces on the next tick.
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone as dt_timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

import discord
from discord.ext import tasks
from redbot.core import Config, bank, checks, commands

log = logging.getLogger("red.cuff-cogs.cuffbirthday")

LIVE_NODE_JSON = "/home/brand/CuffBot/data/411157175948541954.json"

#: Owner decisions carried over from the Node module as DEFAULTS — every one of
#: them is now editable with a command (S31/S32/S38/S58 in the Node changelog).
DEFAULT_CHANNEL_ID = 411609312037961729
DEFAULT_BIRTHDAY_ROLE_ID = 701577807070756946
DEFAULT_TIMEZONE = "America/New_York"
DEFAULT_GIFT = 50_000

DEFAULT_MESSAGE = (
    "🎂 **Attention all units!** Today is {mention}'s birthday — report to the "
    "break room for cake and donuts. 🎉🍩{gift}"
)
DEFAULT_GIFT_LINE = " The precinct chipped in **{amount} {currency}** 🍩 as a birthday gift!"

EMBED_COLOR = 0xDB6EA4
SUCCESS_COLOR = 0x57F287
ERROR_COLOR = 0xED4245

DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

#: Shown first when someone's timezone does not resolve — the community is
#: US-based, Amsterdam covers the owner.
PRIORITY_TIMEZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/Amsterdam",
    "Europe/London",
    "Europe/Berlin",
]

_DATE_RE = re.compile(r"^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$")


# ---------------------------------------------------------------------------
# Pure calendar rules (ported from lib/birthday.js) — no discord.py objects, so
# every rule below is unit-testable with plain numbers.
# ---------------------------------------------------------------------------


def is_leap_year(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0


def is_valid_birthday(day: Any, month: Any) -> bool:
    """A calendar-valid day/month pair. Feb 29 is allowed — see feb29 rule."""
    if not isinstance(day, int) or not isinstance(month, int):
        return False
    if isinstance(day, bool) or isinstance(month, bool):
        return False
    if month < 1 or month > 12:
        return False
    return 1 <= day <= DAYS_IN_MONTH[month - 1]


def parse_birthday_date(raw: Any, *, current_year: Optional[int] = None) -> Optional[Dict[str, int]]:
    """Parse the owner-mandated ``YYYY/MM/DD`` (``-`` and ``.`` also accepted).

    Validated against the REAL calendar: with the year known, Feb 29 is only
    accepted in actual leap years. Years are bounded to [1900, current year].
    """
    if current_year is None:
        current_year = datetime.now(dt_timezone.utc).year
    match = _DATE_RE.match(str(raw or "").strip())
    if not match:
        return None
    year, month, day = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    if year < 1900 or year > current_year:
        return None
    if month < 1 or month > 12:
        return None
    max_day = 28 if (month == 2 and not is_leap_year(year)) else DAYS_IN_MONTH[month - 1]
    if day < 1 or day > max_day:
        return None
    return {"year": year, "month": month, "day": day}


def is_valid_timezone(name: Any) -> bool:
    """Does the system tz database know this IANA name?"""
    if not isinstance(name, str) or not name.strip():
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return False


def suggest_timezones(query: Any, limit: int = 5) -> List[str]:
    """Near-miss suggestions for a timezone that did not resolve.

    An empty query gets the common zones; anything typed substring-matches the
    full IANA list with the priority zones first. This is what the Node port's
    "did you mean…" line runs on (its S44 slash autocomplete could never fire).
    """
    every = available_timezones()
    text = str(query or "").strip().lower()
    if not text:
        return [zone for zone in PRIORITY_TIMEZONES if zone in every][:limit]
    priority = [z for z in PRIORITY_TIMEZONES if z in every and text in z.lower()]
    rest = sorted(z for z in every if text in z.lower() and z not in priority)
    hits = priority + rest
    if hits:
        return hits[:limit]
    # Nothing contains the query — fall back to fuzzy matching on the last
    # segment, which is how people typo a zone ("Amster" → "Amsterdam").
    import difflib

    tail = text.rsplit("/", 1)[-1]
    by_city = {z.rsplit("/", 1)[-1].lower(): z for z in sorted(every)}
    close = difflib.get_close_matches(tail, list(by_city), n=limit, cutoff=0.6)
    return [by_city[name] for name in close]


def local_date_parts(now_ms: int, tz_name: str) -> Dict[str, int]:
    """The {year, month, day} it currently is in the given timezone."""
    moment = datetime.fromtimestamp(now_ms / 1000, tz=ZoneInfo(tz_name))
    return {"year": moment.year, "month": moment.month, "day": moment.day}


def record_timezone(record: Dict[str, Any]) -> str:
    """The record's timezone, or the fallback when it is missing/bogus."""
    tz_name = record.get("timezone") or record.get("timeZone")
    return tz_name if is_valid_timezone(tz_name) else DEFAULT_TIMEZONE


def is_birthday_on(record: Dict[str, Any], local: Dict[str, int]) -> bool:
    """Is this record's birthday "today" for the given local date?

    Leaplings are celebrated on Feb 29 in leap years and on **Mar 1** in other
    years — nobody skips three years of donuts.
    """
    if record.get("month") == 2 and record.get("day") == 29 and not is_leap_year(local["year"]):
        return local["month"] == 3 and local["day"] == 1
    return local["month"] == record.get("month") and local["day"] == record.get("day")


def due_birthdays(users: Dict[str, Any], now_ms: int) -> List[Tuple[str, int]]:
    """Everyone whose birthday is today in their own timezone AND who has not
    been announced yet this local year. Returns ``[(user_id, local_year)]``."""
    due: List[Tuple[str, int]] = []
    for user_id, record in (users or {}).items():
        if not isinstance(record, dict) or not is_valid_birthday(record.get("day"), record.get("month")):
            continue
        local = local_date_parts(now_ms, record_timezone(record))
        if is_birthday_on(record, local) and record.get("last_announced_year") != local["year"]:
            due.append((str(user_id), local["year"]))
    return due


def birthday_celebrants(users: Dict[str, Any], now_ms: int) -> List[str]:
    """Everyone whose birthday it is RIGHT NOW in their own timezone.

    Unlike :func:`due_birthdays` this ignores the announce stamp — the birthday
    ROLE must be worn for the whole local day, not just at announcement time.
    """
    out: List[str] = []
    for user_id, record in (users or {}).items():
        if not isinstance(record, dict) or not is_valid_birthday(record.get("day"), record.get("month")):
            continue
        if is_birthday_on(record, local_date_parts(now_ms, record_timezone(record))):
            out.append(str(user_id))
    return out


def days_until_birthday(record: Dict[str, Any], now_ms: int) -> int:
    """Days until the next occurrence, measured in the member's own timezone
    (0 = today). Calendar-day arithmetic, so DST shifts cannot skew it."""
    local = local_date_parts(now_ms, record_timezone(record))
    if is_birthday_on(record, local):
        return 0

    def day_number(year: int, month: int, day: int) -> int:
        return datetime(year, month, day, tzinfo=dt_timezone.utc).toordinal()

    today = day_number(local["year"], local["month"], local["day"])
    for year in (local["year"], local["year"] + 1):
        if record["month"] == 2 and record["day"] == 29 and not is_leap_year(year):
            month, day = 3, 1  # same Mar 1 rule as announcing
        else:
            month, day = record["month"], record["day"]
        candidate = day_number(year, month, day)
        if candidate > today:
            return candidate - today
    return 366  # unreachable, but a sane ceiling


def next_birthdays(users: Dict[str, Any], now_ms: int, count: int = 5) -> List[Dict[str, Any]]:
    """Upcoming birthdays, soonest first. Today's birthdays sort first."""
    rows = [
        {"user_id": str(uid), "record": rec, "days_until": days_until_birthday(rec, now_ms)}
        for uid, rec in (users or {}).items()
        if isinstance(rec, dict) and is_valid_birthday(rec.get("day"), rec.get("month"))
    ]
    rows.sort(key=lambda row: (row["days_until"], row["user_id"]))
    return rows[: max(1, count)]


def format_birthday(record: Dict[str, Any]) -> str:
    """"24 July" — how a stored birthday reads in messages (never the year)."""
    month = record.get("month")
    name = MONTHS[month - 1] if isinstance(month, int) and 1 <= month <= 12 else "?"
    return f"{record.get('day')} {name}"


def render_announcement(template: str, *, user_id: int, gift_line: str) -> str:
    """Fill the announcement template. Unknown placeholders are left alone
    rather than raising — a typo in a template must not silence a birthday."""
    mention = f"<@{user_id}>"
    for key, value in (("{mention}", mention), ("{user}", mention), ("{gift}", gift_line)):
        template = template.replace(key, value)
    return template


def now_ms() -> int:
    return int(datetime.now(dt_timezone.utc).timestamp() * 1000)


# ---------------------------------------------------------------------------
# Replies — every answer this cog gives is an embed, so the three helpers below
# are the only place a colour or a mention policy is decided.
# ---------------------------------------------------------------------------


async def send_embed(
    ctx: commands.Context, description: str, *, title: str, color: int = EMBED_COLOR
) -> discord.Message:
    """Answer with an embed, never pinging anyone the text happens to mention."""
    embed = discord.Embed(color=color, title=title, description=description)
    return await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())


async def send_ok(ctx: commands.Context, description: str, *, title: str = "✅ Done") -> discord.Message:
    return await send_embed(ctx, description, title=title, color=SUCCESS_COLOR)


async def send_error(
    ctx: commands.Context, description: str, *, title: str = "🚫 Not so fast, officer"
) -> discord.Message:
    return await send_embed(ctx, description, title=title, color=ERROR_COLOR)


# ---------------------------------------------------------------------------
# The cog
# ---------------------------------------------------------------------------


class CuffBirthday(commands.Cog):
    """Birthday watch: register once, get celebrated on your own calendar day."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175006, force_registration=True)
        self.config.register_guild(
            enabled=True,
            channel_id=DEFAULT_CHANNEL_ID,
            birthday_role_id=DEFAULT_BIRTHDAY_ROLE_ID,
            default_timezone=DEFAULT_TIMEZONE,
            gift_enabled=True,
            gift_amount=DEFAULT_GIFT,
            ping_celebrant=True,
            message=DEFAULT_MESSAGE,
            #: Announce with an embed card. The ping still rides in the message
            #: content — a mention inside an embed never notifies anyone.
            embed_announcement=True,
            #: user id (str) -> {day, month, year, timezone, last_announced_year}
            birthdays={},
            #: user id (str) -> True, for roles WE granted (never strip a manual one)
            role_holders={},
        )
        #: The sweep cadence is a loop property, not a per-guild one.
        self.config.register_global(sweep_minutes=10)
        self._sweep_lock = asyncio.Lock()
        self._ready = asyncio.Event()
        self._startup = asyncio.create_task(self._start_sweep())

    async def _start_sweep(self) -> None:
        await self.bot.wait_until_red_ready()
        minutes = await self.config.sweep_minutes()
        self.sweep_loop.change_interval(minutes=max(1, int(minutes)))
        self.sweep_loop.start()
        self._ready.set()

    def cog_unload(self):
        self.sweep_loop.cancel()
        if self._startup is not None:
            self._startup.cancel()

    async def red_delete_data_for_user(self, *, requester, user_id: int):
        """A birthday IS end-user data — remove it everywhere on request."""
        for guild in self.bot.guilds:
            group = self.config.guild(guild)
            async with group.birthdays() as birthdays:
                birthdays.pop(str(user_id), None)
            async with group.role_holders() as holders:
                holders.pop(str(user_id), None)

    # ------------------------------------------------------------------
    # The sweep
    # ------------------------------------------------------------------

    @tasks.loop(minutes=10)
    async def sweep_loop(self):
        # One sweep at a time: a slow guild must not overlap with the next tick.
        if self._sweep_lock.locked():
            return
        async with self._sweep_lock:
            for guild in list(self.bot.guilds):
                try:
                    # Role first: the celebrant already wears it when the
                    # announcement lands. Each step has its own guard — a role
                    # failure must never silence the announcement, or vice versa.
                    try:
                        await self.sync_birthday_role(guild)
                    except Exception:
                        log.warning("Birthdays: role sync failed in guild %s", guild.id, exc_info=True)
                    await self.sweep_birthdays(guild)
                except Exception:
                    log.warning("Birthdays: sweep failed in guild %s", guild.id, exc_info=True)

    @sweep_loop.before_loop
    async def _before_sweep(self):
        await self.bot.wait_until_red_ready()

    async def sync_birthday_role(self, guild: discord.Guild, moment: Optional[int] = None) -> Dict[str, int]:
        """Keep the birthday role in sync: celebrants get it for their whole
        LOCAL day, and members WE granted it to lose it once their day ends.

        Only roles this cog granted are ever removed (the ``role_holders`` map)
        — a manually assigned birthday role is never stripped. Failures are
        logged and retried next tick; a member who left just drops off the list.
        """
        moment = now_ms() if moment is None else moment
        conf = await self.config.guild(guild).all()
        result = {"added": 0, "removed": 0}
        role_id = conf["birthday_role_id"]
        if not conf["enabled"] or not role_id:
            return result
        role = guild.get_role(int(role_id))
        if role is None:
            return result

        celebrants = set(birthday_celebrants(conf["birthdays"], moment))
        holders = dict(conf["role_holders"])

        async def set_holder(user_id: str, on: bool) -> None:
            async with self.config.guild(guild).role_holders() as tracked:
                if on:
                    tracked[user_id] = True
                else:
                    tracked.pop(user_id, None)

        for user_id in celebrants:
            member = guild.get_member(int(user_id))
            if member is None:
                try:
                    member = await guild.fetch_member(int(user_id))
                except (discord.NotFound, discord.HTTPException):
                    continue  # left the guild — nothing to wear the role
            try:
                if role not in member.roles:
                    await member.add_roles(role, reason="Birthday role: it is their birthday — via CuffBot")
                    result["added"] += 1
                await set_holder(user_id, True)
            except discord.HTTPException as error:
                log.warning("Birthdays: could not give the birthday role to %s: %s", user_id, error)

        for user_id in list(holders):
            if user_id in celebrants:
                continue
            try:
                member = guild.get_member(int(user_id))
                if member is not None and role in member.roles:
                    await member.remove_roles(role, reason="Birthday role: the day is over — via CuffBot")
                    result["removed"] += 1
                await set_holder(user_id, False)  # gone or stripped either way
            except discord.HTTPException as error:
                # Hierarchy/permissions/API: keep tracking, retry next tick.
                log.warning("Birthdays: could not remove the birthday role from %s: %s", user_id, error)
        return result

    async def sweep_birthdays(self, guild: discord.Guild, moment: Optional[int] = None) -> int:
        """Announce every birthday that has started, once per local year."""
        moment = now_ms() if moment is None else moment
        conf = await self.config.guild(guild).all()
        if not conf["enabled"] or not conf["channel_id"]:
            return 0
        channel = guild.get_channel(int(conf["channel_id"]))
        if channel is None:
            try:
                channel = await guild.fetch_channel(int(conf["channel_id"]))
            except (discord.NotFound, discord.Forbidden, discord.HTTPException):
                return 0
        if not isinstance(channel, (discord.TextChannel, discord.Thread)):
            return 0

        announced = 0
        for user_id, local_year in due_birthdays(conf["birthdays"], moment):
            # Stamp FIRST: if the send fails we skip this year rather than risk
            # a pile-up of duplicate announcements on every later tick.
            async with self.config.guild(guild).birthdays() as birthdays:
                if user_id not in birthdays:
                    continue
                birthdays[user_id]["last_announced_year"] = local_year

            gift_line = ""
            if conf["gift_enabled"] and conf["gift_amount"] > 0:
                # Cross-cog seam: a broken bank must never silence the birthday.
                try:
                    member = guild.get_member(int(user_id))
                    if member is not None:
                        await bank.deposit_credits(member, int(conf["gift_amount"]))
                        currency = await bank.get_currency_name(guild)
                        gift_line = DEFAULT_GIFT_LINE.format(
                            amount=f"{int(conf['gift_amount']):,}", currency=currency
                        )
                except Exception:
                    log.warning("Birthdays: gift failed for %s", user_id, exc_info=True)

            rendered = render_announcement(conf["message"], user_id=int(user_id), gift_line=gift_line)
            mentions = (
                discord.AllowedMentions(everyone=False, roles=False, users=[discord.Object(id=int(user_id))])
                if conf["ping_celebrant"]
                else discord.AllowedMentions.none()
            )

            content: Optional[str] = rendered
            embed: Optional[discord.Embed] = None
            # An embed card, but the ping has to stay in the content: a mention
            # inside an embed renders as a link and notifies nobody.
            if conf.get("embed_announcement", True) and channel.permissions_for(guild.me).embed_links:
                content = f"<@{user_id}>" if conf["ping_celebrant"] else None
                embed = discord.Embed(
                    color=EMBED_COLOR, title="🎂 Happy Birthday!", description=rendered
                )
                member = guild.get_member(int(user_id))
                if member is not None:
                    embed.set_thumbnail(url=member.display_avatar.url)
                    embed.set_author(name=member.display_name, icon_url=member.display_avatar.url)
                if gift_line:
                    embed.add_field(name="🍩 Gift", value=gift_line.strip(), inline=False)
                embed.set_footer(text=f"{guild.name} · celebrated on their own calendar day")

            try:
                await channel.send(content=content, embed=embed, allowed_mentions=mentions)
                announced += 1
            except discord.HTTPException as error:
                log.warning("Birthdays: announcement failed: %s", error)
        return announced

    # ------------------------------------------------------------------
    # Member commands
    # ------------------------------------------------------------------

    @commands.guild_only()
    @commands.group(name="birthday", aliases=["birthday-config", "bday"], invoke_without_command=True)
    async def birthday(self, ctx: commands.Context):
        """Birthdays: register your own, and (admins) how they are announced."""
        conf = await self.config.guild(ctx.guild).all()
        mine = conf["birthdays"].get(str(ctx.author.id))
        minutes = await self.config.sweep_minutes()

        channel = (
            f"<#{conf['channel_id']}>"
            if conf["channel_id"]
            else "⚠️ not set — nothing is announced"
        )
        role = f"<@&{conf['birthday_role_id']}>" if conf["birthday_role_id"] else "none"
        if conf["gift_enabled"] and conf["gift_amount"] > 0:
            currency = await bank.get_currency_name(ctx.guild)
            gift = f"{int(conf['gift_amount']):,} {currency}"
        else:
            gift = "off"

        embed = discord.Embed(
            color=EMBED_COLOR,
            title="🎂 Birthday Watch",
            description=(
                "Register once and the precinct celebrates you on **your own** calendar day, "
                "once a year. The birth year is stored but never shown."
            ),
        )
        if ctx.guild.icon:
            embed.set_thumbnail(url=ctx.guild.icon.url)

        # Your own record first — it is what most people ran this for.
        if mine:
            days = days_until_birthday(mine, now_ms())
            when = "**today** 🎉" if days == 0 else ("**tomorrow**" if days == 1 else f"in **{days}** days")
            embed.add_field(
                name="🎈 Your birthday",
                value=(
                    f"**{format_birthday(mine)}** — {when}\n"
                    f"Timezone: `{record_timezone(mine)}`"
                ),
                inline=False,
            )
        else:
            embed.add_field(
                name="🎈 Your birthday",
                value=(
                    "Not set yet.\n"
                    f"`{ctx.clean_prefix}birthday set 1990/05/23 [timezone]`"
                ),
                inline=False,
            )

        embed.add_field(
            name="Status", value="🟢 Enabled" if conf["enabled"] else "🔴 Disabled", inline=True
        )
        embed.add_field(name="Channel", value=channel, inline=True)
        embed.add_field(name="Gift", value=f"🍩 {gift}", inline=True)
        embed.add_field(
            name="Birthday role",
            value=(
                f"{role} — worn the whole local day" if conf["birthday_role_id"] else "none"
            ),
            inline=True,
        )
        embed.add_field(name="Sweep", value=f"every {minutes} min", inline=True)
        embed.add_field(name="Ping", value="yes" if conf["ping_celebrant"] else "no", inline=True)
        embed.add_field(
            name="Announcement",
            value="embed card" if conf.get("embed_announcement", True) else "plain text",
            inline=True,
        )

        embed.add_field(
            name="Commands",
            value=(
                f"`{ctx.clean_prefix}birthday set <YYYY/MM/DD> [timezone]` — register\n"
                f"`{ctx.clean_prefix}birthday remove` — strike it from the record\n"
                f"`{ctx.clean_prefix}birthdays` — the next upcoming birthdays"
            ),
            inline=False,
        )
        embed.set_footer(
            text=f"{ctx.guild.name} · {len(conf['birthdays'])} birthday(s) on file",
            icon_url=ctx.author.display_avatar.url,
        )
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())

    @birthday.command(name="set", aliases=["add", "mine"])
    async def birthday_set(self, ctx: commands.Context, date: str, timezone: Optional[str] = None):
        """Register your birthday: `<YYYY/MM/DD> [timezone]`.

        The year is validated and stored, but it is never announced — only the
        day and month are ever shown.
        """
        conf = await self.config.guild(ctx.guild).all()
        if timezone is None:
            timezone = conf["default_timezone"]
        parsed = parse_birthday_date(date)
        if parsed is None:
            await send_error(
                ctx,
                f"`{date}` doesn't parse. Use **YYYY/MM/DD** — e.g. `1990/05/23` — and make it a "
                "real calendar date (year 1900 or later, no time travel).",
                title="🚫 That's not a date",
            )
            return
        if not is_valid_timezone(timezone):
            near = suggest_timezones(timezone)
            hint = (
                "Did you mean " + ", ".join(f"`{zone}`" for zone in near) + "?"
                if near
                else "Use an IANA name like `America/New_York`, `America/Chicago`, `Europe/Amsterdam`."
            )
            await send_error(
                ctx, f"`{timezone}` is not a timezone I know. {hint}", title="🚫 Unknown timezone"
            )
            return

        record = {
            "day": parsed["day"],
            "month": parsed["month"],
            "year": parsed["year"],
            "timezone": timezone,
        }
        async with self.config.guild(ctx.guild).birthdays() as birthdays:
            # Keep the announce stamp on a re-set so the same day cannot be
            # announced twice by editing the record.
            previous = birthdays.get(str(ctx.author.id)) or {}
            if previous.get("last_announced_year") is not None and (
                previous.get("day") == record["day"] and previous.get("month") == record["month"]
            ):
                record["last_announced_year"] = previous["last_announced_year"]
            birthdays[str(ctx.author.id)] = record

        days = days_until_birthday(record, now_ms())
        when = "**today** 🎉" if days == 0 else ("**tomorrow**" if days == 1 else f"in **{days}** days")
        embed = discord.Embed(
            color=SUCCESS_COLOR,
            title="🎂 Birthday on file",
            description=(
                f"Noted, **{ctx.author.display_name}** — the precinct will be informed on the day."
            ),
        )
        embed.set_thumbnail(url=ctx.author.display_avatar.url)
        embed.add_field(name="Date", value=f"**{format_birthday(record)}** — {when}", inline=True)
        embed.add_field(name="Timezone", value=f"`{timezone}`", inline=True)
        embed.add_field(
            name="Birth year",
            # Confirm we stored it, but never show it back in a public channel.
            value=f"stored (**{parsed['year']}**) — never announced",
            inline=False,
        )
        embed.set_footer(text=f"Remove it any time with {ctx.clean_prefix}birthday remove")
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())

    @birthday.command(name="remove", aliases=["delete", "clear"])
    async def birthday_remove(self, ctx: commands.Context):
        """Remove your stored birthday (no more announcements)."""
        async with self.config.guild(ctx.guild).birthdays() as birthdays:
            existed = birthdays.pop(str(ctx.author.id), None) is not None
        async with self.config.guild(ctx.guild).role_holders() as holders:
            holders.pop(str(ctx.author.id), None)
        if existed:
            await send_embed(
                ctx,
                "Your birthday has been struck from the record. No cake, no candles, no announcement.",
                title="🗑️ Record cleared",
                color=SUCCESS_COLOR,
            )
        else:
            await send_embed(
                ctx,
                f"There was no birthday on file for you. Register one with "
                f"`{ctx.clean_prefix}birthday set 1990/05/23`.",
                title="ℹ️ Nothing to remove",
            )

    @commands.guild_only()
    @commands.command(name="birthdays")
    async def birthdays_list(self, ctx: commands.Context, count: int = 5):
        """Show the next upcoming birthdays in the precinct (1–15)."""
        if count < 1 or count > 15:
            await send_error(ctx, "Pick a count between **1** and **15**.", title="🚫 Out of range")
            return
        users = await self.config.guild(ctx.guild).birthdays()
        upcoming = next_birthdays(users, now_ms(), count)

        embed = discord.Embed(color=EMBED_COLOR, title="🎂 Upcoming Birthdays")
        if ctx.guild.icon:
            embed.set_thumbnail(url=ctx.guild.icon.url)
        if not upcoming:
            embed.description = (
                f"No birthdays on file yet. Register yours with "
                f"`{ctx.clean_prefix}birthday set 1990/05/23` — the precinct loves cake."
            )
            embed.set_footer(text=f"{ctx.guild.name} · 0 birthdays on file")
        else:
            rows = []
            for position, row in enumerate(upcoming, start=1):
                days = row["days_until"]
                when = "**TODAY** 🎉" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")
                marker = "🎉" if days == 0 else f"`{position}.`"
                rows.append(
                    f"{marker} <@{row['user_id']}> — **{format_birthday(row['record'])}** ({when})"
                )
            embed.description = "\n".join(rows)
            embed.set_footer(
                text=f"{len(users)} on file · days count in each member's own timezone · "
                f"{ctx.clean_prefix}birthday set to join the list"
            )
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())

    # ------------------------------------------------------------------
    # Admin settings
    # ------------------------------------------------------------------

    @birthday.command(name="on")
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_on(self, ctx: commands.Context):
        """Turn birthday announcements on."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await send_ok(ctx, "Birthday announcements are **on**.", title="🟢 Birthday watch enabled")

    @birthday.command(name="off")
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_off(self, ctx: commands.Context):
        """Turn birthday announcements off."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await send_embed(
            ctx,
            "Birthday announcements are **off**. Registered birthdays are kept.",
            title="📴 Birthday watch disabled",
        )

    @birthday.command(name="channel")
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_channel(self, ctx: commands.Context, channel: discord.TextChannel):
        """Channel where birthdays are announced."""
        await self.config.guild(ctx.guild).channel_id.set(channel.id)
        note = ""
        if not channel.permissions_for(ctx.guild.me).send_messages:
            note = "\n\n⚠️ I cannot send messages there — fix that or nothing will be announced."
        await send_ok(
            ctx, f"Birthdays are announced in {channel.mention}.{note}", title="✅ Channel set"
        )

    @birthday.command(name="role", aliases=["birthday-role"])
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_role(self, ctx: commands.Context, role: discord.Role):
        """Role celebrants wear for their whole birthday."""
        await self.config.guild(ctx.guild).birthday_role_id.set(role.id)
        note = ""
        me = ctx.guild.me
        if me is not None and role >= me.top_role:
            note = (
                "\n\n⚠️ That role sits at or above mine, so I cannot hand it out. "
                "Move my role above it."
            )
        await send_ok(
            ctx,
            f"Celebrants wear **{role.name}** for their whole (local) birthday.{note}",
            title="✅ Birthday role set",
        )

    @birthday.command(name="norole", aliases=["no-birthday-role"])
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_norole(self, ctx: commands.Context):
        """Stop handing out a birthday role."""
        await self.config.guild(ctx.guild).birthday_role_id.set(None)
        await send_ok(ctx, "No birthday role is handed out any more.", title="✅ Birthday role off")

    @birthday.command(name="gift")
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_gift(self, ctx: commands.Context, amount: int):
        """Birthday gift paid into the bank (0 turns the gift off)."""
        if amount < 0:
            await send_error(ctx, "A negative gift is not a gift, officer.", title="🚫 Bad amount")
            return
        await self.config.guild(ctx.guild).gift_amount.set(amount)
        await self.config.guild(ctx.guild).gift_enabled.set(amount > 0)
        if amount == 0:
            await send_ok(ctx, "No birthday gift is paid out.", title="✅ Gift off")
            return
        currency = await bank.get_currency_name(ctx.guild)
        await send_ok(ctx, f"Celebrants receive **{amount:,} {currency}** 🍩.", title="✅ Gift set")

    @birthday.command(name="timezone", aliases=["tz"])
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_timezone(self, ctx: commands.Context, name: str):
        """Default timezone for members who don't name one."""
        if not is_valid_timezone(name):
            near = suggest_timezones(name)
            hint = (
                " Did you mean " + ", ".join(f"`{zone}`" for zone in near) + "?" if near else ""
            )
            await send_error(
                ctx, f"`{name}` is not a timezone I know.{hint}", title="🚫 Unknown timezone"
            )
            return
        await self.config.guild(ctx.guild).default_timezone.set(name)
        await send_ok(
            ctx,
            f"New registrations default to **{name}** when the member doesn't name one.",
            title="✅ Default timezone set",
        )

    @birthday.command(name="ping")
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_ping(self, ctx: commands.Context, on_off: bool):
        """Whether the announcement pings the celebrant."""
        await self.config.guild(ctx.guild).ping_celebrant.set(on_off)
        await send_ok(
            ctx,
            "The celebrant is pinged in the announcement."
            if on_off
            else "The announcement stays silent — the mention is shown but does not ping.",
            title="✅ Ping updated",
        )

    @birthday.command(name="embed")
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_embed(self, ctx: commands.Context, on_off: bool):
        """Announce with an embed card (on) or as plain text (off)."""
        await self.config.guild(ctx.guild).embed_announcement.set(on_off)
        await send_ok(
            ctx,
            "Birthdays are announced as an **embed card**. The celebrant is still pinged in the "
            "message itself — a mention inside an embed notifies nobody."
            if on_off
            else "Birthdays are announced as **plain text**, exactly as the template reads.",
            title="✅ Announcement style set",
        )

    @birthday.command(name="message")
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_message(self, ctx: commands.Context, *, template: Optional[str] = None):
        """Announcement text. Placeholders: `{mention}`, `{gift}`. No text = show the current one."""
        group = self.config.guild(ctx.guild)

        def with_preview(text: str, *, title: str, color: int) -> discord.Embed:
            """Template + rendered preview, side by side — what you set is what
            the channel gets, minus the ping."""
            def clip(value: str, limit: int) -> str:
                # Say so when we shorten, rather than let a long template look
                # as if it were stored truncated.
                return value if len(value) <= limit else value[: limit - 1] + "…"

            embed = discord.Embed(color=color, title=title)
            embed.add_field(name="Template", value=f"```\n{clip(text, 1000)}\n```", inline=False)
            embed.add_field(
                name="Preview",
                value=clip(render_announcement(text, user_id=ctx.author.id, gift_line=""), 1024),
                inline=False,
            )
            embed.set_footer(
                text=f"Placeholders: {{mention}}, {{gift}} · "
                f"{ctx.clean_prefix}birthday message default to reset"
            )
            return embed

        if template is None:
            current = await group.message()
            await ctx.send(
                embed=with_preview(current, title="💬 Current announcement", color=EMBED_COLOR),
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return
        if template.strip().lower() == "default":
            await group.message.set(DEFAULT_MESSAGE)
            await ctx.send(
                embed=with_preview(
                    DEFAULT_MESSAGE, title="✅ Announcement reset to the default", color=SUCCESS_COLOR
                ),
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return
        if "{mention}" not in template and "{user}" not in template:
            await send_error(
                ctx,
                "The template needs `{mention}` — otherwise nobody knows whose birthday it is.",
                title="🚫 Missing placeholder",
            )
            return
        await group.message.set(template)
        await ctx.send(
            embed=with_preview(template, title="✅ Announcement set", color=SUCCESS_COLOR),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @birthday.command(name="interval")
    @checks.is_owner()
    async def birthday_interval(self, ctx: commands.Context, minutes: int):
        """How often the sweep runs, in minutes (bot-wide)."""
        if minutes < 1 or minutes > 120:
            await send_error(ctx, "Pick between **1** and **120** minutes.", title="🚫 Out of range")
            return
        await self.config.sweep_minutes.set(minutes)
        self.sweep_loop.change_interval(minutes=minutes)
        await send_ok(
            ctx, f"The sweep runs every **{minutes}** minutes (bot-wide).", title="✅ Sweep interval set"
        )

    @birthday.command(name="forcesweep", aliases=["runsweep"])
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_forcesweep(self, ctx: commands.Context):
        """Run the sweep right now (role sync + any due announcements)."""
        async with ctx.typing():
            roles = await self.sync_birthday_role(ctx.guild)
            announced = await self.sweep_birthdays(ctx.guild)
        embed = discord.Embed(color=SUCCESS_COLOR, title="🧹 Sweep complete")
        embed.add_field(name="Announced", value=f"**{announced}**", inline=True)
        embed.add_field(name="Role added", value=f"**{roles['added']}**", inline=True)
        embed.add_field(name="Role removed", value=f"**{roles['removed']}**", inline=True)
        embed.set_footer(text="Zeroes are normal — nobody's local day started since the last sweep")
        await ctx.send(embed=embed)

    @birthday.command(name="forget")
    @checks.admin_or_permissions(manage_guild=True)
    async def birthday_forget(self, ctx: commands.Context, member: discord.Member):
        """Remove someone else's stored birthday."""
        async with self.config.guild(ctx.guild).birthdays() as birthdays:
            existed = birthdays.pop(str(member.id), None) is not None
        if existed:
            # The role tracker has to go too, or the sweep keeps trying to strip
            # a role from someone it no longer has a birthday for.
            async with self.config.guild(ctx.guild).role_holders() as holders:
                holders.pop(str(member.id), None)
            await send_embed(
                ctx,
                f"Removed the birthday on file for **{member.display_name}**.",
                title="🗑️ Record cleared",
                color=SUCCESS_COLOR,
            )
        else:
            await send_embed(
                ctx,
                f"No birthday was on file for **{member.display_name}**.",
                title="ℹ️ Nothing to remove",
            )

    @birthday.command(name="migratecuff")
    @checks.is_owner()
    async def birthday_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = LIVE_NODE_JSON
    ):
        """Migrate birthdays and settings from the CuffBot Node data file.

        `mode` is `preview` (show what would be written) or `apply` (default).
        Only keys present in the Node JSON are written; absent keys stay at the
        cog defaults. Safe to run more than once.
        """
        mode = mode.lower()
        if mode not in ("preview", "apply"):
            await send_error(
                ctx,
                f"Unknown mode `{mode}`. Use `{ctx.clean_prefix}birthday migratecuff preview` "
                f"or `{ctx.clean_prefix}birthday migratecuff apply`.",
                title="🚫 Unknown mode",
            )
            return
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            await send_error(
                ctx, f"Could not read the Node data file at `{path}`:\n```\n{error}\n```",
                title="🚫 Migration failed",
            )
            return

        changes: Dict[str, Any] = {}
        node_config = data.get("birthdayConfig")
        if isinstance(node_config, dict):
            if "enabled" in node_config:
                changes["enabled"] = bool(node_config["enabled"])
            if node_config.get("channelId"):
                changes["channel_id"] = int(node_config["channelId"])
            if "birthdayRoleId" in node_config:
                role_id = node_config["birthdayRoleId"]
                changes["birthday_role_id"] = int(role_id) if role_id else None

        node_users = data.get("birthdayUsers")
        if isinstance(node_users, dict):
            migrated: Dict[str, Any] = {}
            for user_id, record in node_users.items():
                if not isinstance(record, dict):
                    continue
                day, month = record.get("day"), record.get("month")
                if not is_valid_birthday(day, month):
                    continue
                entry = {
                    "day": int(day),
                    "month": int(month),
                    # The Node key is timeZone; ours is timezone.
                    "timezone": record.get("timeZone") or DEFAULT_TIMEZONE,
                }
                if record.get("year"):
                    entry["year"] = int(record["year"])
                if record.get("lastAnnouncedYear") is not None:
                    entry["last_announced_year"] = int(record["lastAnnouncedYear"])
                migrated[str(user_id)] = entry
            if migrated:
                changes["birthdays"] = migrated

        node_holders = data.get("birthdayRoleHolders")
        if isinstance(node_holders, dict) and node_holders:
            changes["role_holders"] = {str(uid): True for uid in node_holders}

        if not changes:
            await send_embed(
                ctx,
                f"Nothing to migrate: the Node data file at `{path}` has no birthday keys.",
                title="ℹ️ Nothing to migrate",
            )
            return

        summary = "\n".join(
            f"{key} = {value if not isinstance(value, (list, dict)) else f'<{len(value)} entries>'}"
            for key, value in changes.items()
        )

        def migration_embed(*, title: str, color: int, note: str) -> discord.Embed:
            embed = discord.Embed(color=color, title=title, description=note)
            embed.add_field(name="Changes", value=f"```\n{summary[:1000]}\n```", inline=False)
            embed.set_footer(text=f"Source: {path}")
            return embed

        if mode == "preview":
            await ctx.send(
                embed=migration_embed(
                    title="🔍 Birthday migration preview",
                    color=EMBED_COLOR,
                    note="Nothing has been written. Run it again with `apply` to commit.",
                )
            )
            return

        group = self.config.guild(ctx.guild)
        for key, value in changes.items():
            await group.get_attr(key).set(value)
        await ctx.send(
            embed=migration_embed(
                title="✅ Birthday migration applied",
                color=SUCCESS_COLOR,
                note="Settings and birthdays were written. Safe to run again.",
            )
        )
