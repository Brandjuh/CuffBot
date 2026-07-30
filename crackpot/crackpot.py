"""CrackPot — donut steal + donut pot on top of Red's bank.

Port of the steal/pot half of the Node CuffBot economy module.
The pot is fed by busted steals, escaped crooks (via the CrookHunt cog),
internal-affairs fines, and a lazy daily top-up.
"""

import asyncio
import datetime
import json
import logging
import random
import time
from pathlib import Path
from typing import Literal, Optional

import discord
from redbot.core import Config, bank, checks, commands
from redbot.core.bot import Red
from redbot.core.errors import BalanceTooHigh

log = logging.getLogger("red.cuffcogs.crackpot")

NODE_DATA_DEFAULT = "/home/brand/CuffBot/data/411157175948541954.json"

DEFAULT_GUILD = {
    "enabled": True,
    "heist_chance": 0.3,          # odds a steal succeeds
    "heist_min": 5,               # donuts at stake, low end
    "heist_max": 500,             # donuts at stake, high end
    "backfire_chance": 0.05,      # odds the victim catches and robs the thief
    "heist_cooldown_ms": 10_800_000,  # 3 hours between attempts, per thief
    "revenge_lock_ms": 43_200_000,    # 12 hours before the victim may hit back
    "pot_daily_topup": 500,
    "pot_win_chance": 0.005,      # 0.5%
    "pot": {"balance": 0, "last_topup_day": "", "attempts": {}},
}

DEFAULT_MEMBER = {
    "last_heist_at": 0,
    #: victim id (str) -> when THIS member last successfully robbed them. Read
    #: from the other direction to enforce the no-revenge window.
    "robbed_victims": {},
    #: UTC day this member was last successfully robbed — one per day, at most.
    "last_robbed_day": "",
}


def _utc_day(now_ms: Optional[int] = None) -> str:
    ts = (now_ms if now_ms is not None else int(time.time() * 1000)) / 1000
    return datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).strftime(
        "%Y-%m-%d"
    )


def _days_between(day_a: str, day_b: str) -> int:
    try:
        a = datetime.date.fromisoformat(day_a)
        b = datetime.date.fromisoformat(day_b)
    except ValueError:
        return 0
    return max(0, (b - a).days)


def _format_wait_ms(ms: int) -> str:
    minutes = -(-ms // 60_000)  # ceil
    hours, mins = divmod(minutes, 60)
    if hours > 0:
        return f"{hours} h {mins} min"
    return f"{mins} min"


def _gold(n: int) -> str:
    return f"{n:,} 🍩"


def _next_utc_midnight_ts(now_ms: Optional[int] = None) -> int:
    """Unix seconds of the next UTC midnight — when the daily limits reset."""
    ts = (now_ms if now_ms is not None else int(time.time() * 1000)) / 1000
    now = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
    tomorrow = (now + datetime.timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return int(tomorrow.timestamp())


# --------------------------------------------------------------------- #
# Pure steal rules — plain numbers in, decision out, so the odds and the  #
# lockouts can be tested without a guild.                                #
# --------------------------------------------------------------------- #


def roll_outcome(roll: float, backfire_chance: float, heist_chance: float) -> str:
    """Which of the three endings a steal attempt gets.

    The bands are cumulative and success sits in the MIDDLE, so raising the
    backfire odds eats into the plain busts rather than into the thief's
    chance of getting away with it.
    """
    if roll < backfire_chance:
        return "backfire"
    if roll < backfire_chance + heist_chance:
        return "success"
    return "busted"


def roll_amount(minimum: int, maximum: int, rng: Optional[random.Random] = None) -> int:
    """The donuts at stake for one attempt, inclusive on both ends."""
    low, high = min(minimum, maximum), max(minimum, maximum)
    return (rng or random).randint(max(0, low), max(0, high))


def revenge_block_remaining(
    target_robbed: dict, author_id: int, now_ms: int, lock_ms: int
) -> int:
    """How long the author must still wait before robbing this target back.

    ``target_robbed`` is the TARGET's own map of who they have robbed. If the
    target robbed the author recently, the author may not hit back yet.
    Returns 0 when there is no block.
    """
    stamp = (target_robbed or {}).get(str(author_id))
    if not stamp:
        return 0
    elapsed = now_ms - int(stamp)
    return max(0, lock_ms - elapsed) if elapsed < lock_ms else 0


def prune_robbed(robbed: dict, now_ms: int, lock_ms: int) -> dict:
    """Drop stamps that can no longer block anything — the map is per member
    and would otherwise grow one entry per victim, forever."""
    return {
        victim: stamp
        for victim, stamp in (robbed or {}).items()
        if now_ms - int(stamp) < lock_ms
    }


class CrackPot(commands.Cog):
    """Steal donuts from other officers and crack the donut pot."""

    def __init__(self, bot: Red):
        super().__init__()
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175008, force_registration=True)
        self.config.register_guild(**DEFAULT_GUILD)
        self.config.register_member(**DEFAULT_MEMBER)
        self._pot_locks: dict[int, asyncio.Lock] = {}

    async def red_delete_data_for_user(
        self,
        *,
        requester: Literal["discord_deleted_user", "owner", "user", "user_strict"],
        user_id: int,
    ):
        all_members = await self.config.all_members()
        for guild_id, members in all_members.items():
            await self.config.member_from_ids(guild_id, user_id).clear()
            # The id also appears as a VICTIM in other officers' payback maps.
            for member_id, data in members.items():
                if member_id == user_id:
                    continue
                if str(user_id) in (data.get("robbed_victims") or {}):
                    async with self.config.member_from_ids(
                        guild_id, member_id
                    ).robbed_victims() as robbed:
                        robbed.pop(str(user_id), None)
        all_guilds = await self.config.all_guilds()
        for guild_id, data in all_guilds.items():
            attempts = data.get("pot", {}).get("attempts", {})
            if str(user_id) in attempts:
                async with self.config.guild_from_id(guild_id).pot() as pot:
                    pot.get("attempts", {}).pop(str(user_id), None)

    # ------------------------------------------------------------------ #
    # Bank helpers — replicate Node's "applied" semantics (clamped moves) #
    # ------------------------------------------------------------------ #

    async def _take(self, member: discord.Member, amount: int) -> int:
        """Withdraw up to `amount`, clamped to the member's balance. Returns what was taken."""
        if amount <= 0:
            return 0
        balance = await bank.get_balance(member)
        taken = min(balance, amount)
        if taken > 0:
            await bank.withdraw_credits(member, taken)
        return taken

    async def _give(self, member: discord.Member, amount: int) -> int:
        """Deposit `amount`, clamped to the bank's max balance. Returns what was added."""
        if amount <= 0:
            return 0
        try:
            await bank.deposit_credits(member, amount)
            return amount
        except BalanceTooHigh:
            max_bal = await bank.get_max_balance(member.guild)
            balance = await bank.get_balance(member)
            room = max(0, max_bal - balance)
            if room > 0:
                await bank.deposit_credits(member, room)
            return room

    # --------------------------------------------------------------- #
    # Pot API (used by $crackpot, $steal and the CrookHunt cog)        #
    # --------------------------------------------------------------- #

    def _lock_for(self, guild: discord.Guild) -> asyncio.Lock:
        return self._pot_locks.setdefault(guild.id, asyncio.Lock())

    async def _apply_topup(self, guild: discord.Guild) -> dict:
        """Lazy daily top-up: missed days accumulate on read. Caller must hold the lock."""
        topup = await self.config.guild(guild).pot_daily_topup()
        today = _utc_day()
        async with self.config.guild(guild).pot() as pot:
            last = pot.get("last_topup_day") or ""
            if not last:
                # A fresh pot starts at one top-up.
                pot["balance"] = int(pot.get("balance", 0)) + topup
                pot["last_topup_day"] = today
            else:
                missed = _days_between(last, today)
                if missed > 0:
                    pot["balance"] = int(pot.get("balance", 0)) + missed * topup
                    pot["last_topup_day"] = today
            return dict(pot)

    async def get_pot(self, guild: discord.Guild) -> dict:
        async with self._lock_for(guild):
            return await self._apply_topup(guild)

    async def add_to_pot(self, guild: discord.Guild, amount: int) -> int:
        """Public API: add donuts to the pot. Returns the new pot balance."""
        amount = int(amount)
        async with self._lock_for(guild):
            pot = await self._apply_topup(guild)
            if amount > 0:
                async with self.config.guild(guild).pot() as pot_cfg:
                    pot_cfg["balance"] = int(pot_cfg.get("balance", 0)) + amount
                    return int(pot_cfg["balance"])
            return int(pot.get("balance", 0))

    # ------------------------------- #
    # $steal                          #
    # ------------------------------- #

    @commands.command(name="steal")
    @commands.guild_only()
    async def steal(self, ctx: commands.Context, target: discord.Member):
        """Try to steal donuts from another officer.

        The haul is a random 5–500 donuts. Three ways it can end: you get away
        with it, you get busted and your stake goes into the pot, or — rarely —
        your mark catches you and cleans out YOUR pockets instead.

        Each officer may only be robbed once a day, and a victim may not rob
        their thief back for 12 hours.
        """
        conf = await self.config.guild(ctx.guild).all()
        if not conf["enabled"]:
            await ctx.send("The donut economy add-on is off duty right now.")
            return
        if target.bot:
            await ctx.send("🤖 Bots keep their donuts in the cloud — unstealable.")
            return
        if target.id == ctx.author.id:
            await ctx.send("You pat yourself down and find… your own donuts. Nothing gained.")
            return

        now_ms = int(time.time() * 1000)
        author_conf = await self.config.member(ctx.author).all()
        target_conf = await self.config.member(target).all()

        last = author_conf["last_heist_at"]
        cooldown = conf["heist_cooldown_ms"]
        if last and now_ms - last < cooldown:
            wait = _format_wait_ms(cooldown - (now_ms - last))
            await ctx.send(
                f"🕶️ Lay low, officer — internal affairs is still watching. "
                f"Next attempt in **{wait}**."
            )
            return

        # The two target-side rules are checked BEFORE the cooldown is stamped:
        # being told "not this one" is not an attempt, so it must not burn the
        # thief's three hours.
        if target_conf["last_robbed_day"] == _utc_day(now_ms):
            await ctx.send(
                f"🚔 **{target.display_name}** has already been robbed today — "
                f"one robbery per officer per day. Try again <t:{_next_utc_midnight_ts(now_ms)}:R>."
            )
            return

        blocked = revenge_block_remaining(
            target_conf["robbed_victims"], ctx.author.id, now_ms, conf["revenge_lock_ms"]
        )
        if blocked:
            await ctx.send(
                f"⚖️ **{target.display_name}** robbed you recently, and the precinct "
                f"frowns on immediate payback. You may settle the score in "
                f"**{_format_wait_ms(blocked)}**."
            )
            return

        # Stamp the cooldown BEFORE the roll: a failed roll still costs the cooldown.
        await self.config.member(ctx.author).last_heist_at.set(now_ms)

        amount = roll_amount(conf["heist_min"], conf["heist_max"])
        outcome = roll_outcome(random.random(), conf["backfire_chance"], conf["heist_chance"])

        if outcome == "success":
            loot = await self._take(target, amount)
            if loot > 0:
                await self._give(ctx.author, loot)
                lines = [f"### +{_gold(loot)}"]
                if loot < amount:
                    lines.append("_That was everything they carried._")
                desc = (
                    f"**{ctx.author.display_name}** picked **{target.display_name}**'s pocket.\n"
                    + "\n".join(lines)
                )
            else:
                desc = (
                    f"**{ctx.author.display_name}** picked **{target.display_name}**'s "
                    f"pocket flawlessly… and found it empty."
                )
            # Only a deliberate, successful steal spends the victim's one
            # robbery for the day and arms their 12-hour payback window.
            if loot > 0:
                await self.config.member(target).last_robbed_day.set(_utc_day(now_ms))
                async with self.config.member(ctx.author).robbed_victims() as robbed:
                    pruned = prune_robbed(robbed, now_ms, conf["revenge_lock_ms"])
                    pruned[str(target.id)] = now_ms
                    robbed.clear()
                    robbed.update(pruned)
            embed = discord.Embed(title="🕶️ HEIST!", description=desc, color=0x2ECC71)
            await ctx.send(embed=embed)

        elif outcome == "backfire":
            # The mark saw it coming. No pot, no day-stamp: the victim was not
            # robbed, and they are not owed a payback window for winning.
            snatched = await self._take(ctx.author, amount)
            if snatched > 0:
                await self._give(target, snatched)
                desc = (
                    f"**{target.display_name}** felt the hand in their pocket, spun round, "
                    f"and lifted **{ctx.author.display_name}**'s wallet instead.\n"
                    f"### −{_gold(snatched)}\n"
                    f"_Straight into **{target.display_name}**'s pocket. Humiliating._"
                )
            else:
                desc = (
                    f"**{target.display_name}** caught **{ctx.author.display_name}** "
                    f"red-handed and went through their pockets in revenge… "
                    f"and found nothing worth taking."
                )
            embed = discord.Embed(title="🔄 TABLES TURNED!", description=desc, color=0x9B59B6)
            await ctx.send(embed=embed)

        else:
            seized = await self._take(ctx.author, amount)
            if seized > 0:
                pot_balance = await self.add_to_pot(ctx.guild, seized)
            else:
                pot_balance = int((await self.get_pot(ctx.guild)).get("balance", 0))
            desc = (
                f"**{ctx.author.display_name}** got caught red-handed reaching for "
                f"**{target.display_name}**'s donuts.\n"
                f"### −{_gold(seized)}\n"
                f"_Confiscated into the donut pot — now **{_gold(pot_balance)}**. "
                f"Your shot: `{ctx.clean_prefix}crackpot crack`._"
            )
            embed = discord.Embed(title="🚨 BUSTED!", description=desc, color=0xE74C3C)
            await ctx.send(embed=embed)

    # ------------------------------- #
    # $crackpot                       #
    # ------------------------------- #

    @commands.group(name="crackpot", invoke_without_command=True)
    @commands.guild_only()
    async def crackpot(self, ctx: commands.Context):
        """The donut pot: check it, or take your daily shot at cracking it."""
        await self._send_pot_status(ctx)

    @crackpot.command(name="show", aliases=["status", "view"])
    async def crackpot_show(self, ctx: commands.Context):
        """Show the pot and whether your daily crack attempt is still open."""
        await self._send_pot_status(ctx)

    async def _send_pot_status(self, ctx: commands.Context):
        conf = await self.config.guild(ctx.guild).all()
        pot = await self.get_pot(ctx.guild)
        today = _utc_day()
        attempted = pot.get("attempts", {}).get(str(ctx.author.id)) == today
        shot = (
            "You already took today's shot — new attempt after midnight UTC."
            if attempted
            else f"Your daily shot is **open** — `{ctx.clean_prefix}crackpot crack`."
        )
        chance_pct = conf["pot_win_chance"] * 100
        desc = (
            f"### {_gold(int(pot.get('balance', 0)))}\n"
            f"Fed by busted steals, escaped crooks and a daily "
            f"**+{_gold(conf['pot_daily_topup'])}** top-up.\n"
            f"{shot}\n"
            f"**The odds** — {chance_pct:g}%. Winner takes the whole pot."
        )
        embed = discord.Embed(title="🍯 The Donut Pot", description=desc, color=0xF1C40F)
        await ctx.send(embed=embed)

    @crackpot.command(name="crack", aliases=["attempt"])
    async def crackpot_crack(self, ctx: commands.Context):
        """One shot per day at cracking the pot. Winner takes it all."""
        conf = await self.config.guild(ctx.guild).all()
        if not conf["enabled"]:
            await ctx.send("The donut economy add-on is off duty right now.")
            return
        today = _utc_day()
        async with self._lock_for(ctx.guild):
            await self._apply_topup(ctx.guild)
            async with self.config.guild(ctx.guild).pot() as pot:
                attempts = pot.setdefault("attempts", {})
                if attempts.get(str(ctx.author.id)) == today:
                    await ctx.send(
                        "🍯 You already took today's shot at the pot. "
                        "New attempt after midnight UTC."
                    )
                    return
                win = random.random() < conf["pot_win_chance"]
                attempts[str(ctx.author.id)] = today  # stamped win or lose
                if win:
                    amount = int(pot.get("balance", 0))
                    pot["balance"] = 0
                else:
                    amount = 0
                    balance = int(pot.get("balance", 0))
        if win:
            paid = await self._give(ctx.author, amount)
            desc = (
                f"**{ctx.author.display_name}** cracked the donut pot wide open!\n"
                f"### +{_gold(paid)}\n"
                f"_The pot resets to zero — tomorrow's top-up starts it again._"
            )
            embed = discord.Embed(title="💥 JACKPOT!", description=desc, color=0x2ECC71)
        else:
            desc = (
                f"**{ctx.author.display_name}** fiddles with the lock… nothing.\n"
                f"The pot sits at **{_gold(balance)}**. Try again tomorrow."
            )
            embed = discord.Embed(
                title="🍯 The pot doesn't budge", description=desc, color=0xF1C40F
            )
        await ctx.send(embed=embed)

    # ------------------------------- #
    # Admin / migration               #
    # ------------------------------- #

    @commands.group(name="crackpotset")
    @commands.guild_only()
    @checks.admin_or_permissions(manage_guild=True)
    async def crackpotset(self, ctx: commands.Context):
        """Configure the steal/pot economy add-on."""
        if ctx.invoked_subcommand is None:
            conf = await self.config.guild(ctx.guild).all()
            pot = await self.get_pot(ctx.guild)
            lines = [
                f"Enabled: **{conf['enabled']}**",
                f"Steal: **{conf['heist_chance'] * 100:g}%** success, "
                f"**{conf['backfire_chance'] * 100:g}%** backfire, "
                f"**{(1 - conf['heist_chance'] - conf['backfire_chance']) * 100:g}%** busted",
                f"Haul: **{conf['heist_min']}–{conf['heist_max']} 🍩** at stake, cooldown "
                f"**{_format_wait_ms(conf['heist_cooldown_ms'])}** per thief",
                f"Limits: one robbery per victim per day (UTC), no payback for "
                f"**{_format_wait_ms(conf['revenge_lock_ms'])}**",
                f"Pot: **{_gold(int(pot.get('balance', 0)))}**, top-up "
                f"**+{_gold(conf['pot_daily_topup'])}/day**, crack odds "
                f"**{conf['pot_win_chance'] * 100:g}%**",
            ]
            await ctx.send("\n".join(lines))

    @crackpotset.command(name="on")
    async def crackpotset_on(self, ctx: commands.Context):
        """Enable steal and the pot."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await ctx.tick()

    @crackpotset.command(name="off")
    async def crackpotset_off(self, ctx: commands.Context):
        """Disable steal and the pot."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.tick()

    @crackpotset.command(name="stealchance")
    async def crackpotset_stealchance(self, ctx: commands.Context, percent: float):
        """Odds (0-100%) that a steal succeeds."""
        if not 0 <= percent <= 100:
            await ctx.send("Give a percentage between 0 and 100.")
            return
        chance = percent / 100
        backfire = await self.config.guild(ctx.guild).backfire_chance()
        if chance + backfire > 1:
            await ctx.send(
                f"That leaves no room for a plain bust: backfires are already "
                f"**{backfire * 100:g}%**. Lower `{ctx.clean_prefix}crackpotset backfirechance` first."
            )
            return
        await self.config.guild(ctx.guild).heist_chance.set(chance)
        await ctx.tick()

    @crackpotset.command(name="stealrange", aliases=["stealamount"])
    async def crackpotset_stealrange(
        self, ctx: commands.Context, minimum: int, maximum: Optional[int] = None
    ):
        """Donut range at stake per attempt, e.g. `stealrange 5 500`.

        One number sets a fixed amount (min = max).
        """
        if maximum is None:
            maximum = minimum
        if minimum < 0 or maximum < 0:
            await ctx.send("Donut amounts cannot be negative, officer.")
            return
        if minimum > maximum:
            minimum, maximum = maximum, minimum
        await self.config.guild(ctx.guild).heist_min.set(int(minimum))
        await self.config.guild(ctx.guild).heist_max.set(int(maximum))
        await ctx.send(f"Steals now put **{minimum}–{maximum} 🍩** at stake.")

    @crackpotset.command(name="backfirechance")
    async def crackpotset_backfirechance(self, ctx: commands.Context, percent: float):
        """Odds (0-100%) the victim catches the thief and robs THEM instead."""
        if not 0 <= percent <= 100:
            await ctx.send("Give a percentage between 0 and 100.")
            return
        chance = percent / 100
        success = await self.config.guild(ctx.guild).heist_chance()
        if chance + success > 1:
            await ctx.send(
                f"That leaves no room for a plain bust: success is already "
                f"**{success * 100:g}%**. Lower `{ctx.clean_prefix}crackpotset stealchance` first."
            )
            return
        await self.config.guild(ctx.guild).backfire_chance.set(chance)
        await ctx.send(
            f"Backfire odds set to **{percent:g}%** — busts now cover "
            f"**{(1 - success - chance) * 100:g}%**."
        )

    @crackpotset.command(name="revengelock")
    async def crackpotset_revengelock(self, ctx: commands.Context, hours: float):
        """Hours a victim must wait before robbing their thief back (0-48)."""
        if not 0 <= hours <= 48:
            await ctx.send("Give a number of hours between 0 and 48.")
            return
        await self.config.guild(ctx.guild).revenge_lock_ms.set(int(hours * 3_600_000))
        await ctx.send(
            f"Payback is blocked for **{hours:g} h** after being robbed."
            if hours
            else "Payback is no longer blocked."
        )

    @crackpotset.command(name="stealcooldown")
    async def crackpotset_stealcooldown(self, ctx: commands.Context, hours: float):
        """Hours between steal attempts per thief (0-48)."""
        if not 0 <= hours <= 48:
            await ctx.send("Give a number of hours between 0 and 48.")
            return
        await self.config.guild(ctx.guild).heist_cooldown_ms.set(int(hours * 3_600_000))
        await ctx.tick()

    @crackpotset.command(name="topup")
    async def crackpotset_topup(self, ctx: commands.Context, amount: int):
        """Daily automatic pot top-up (0-100000)."""
        if not 0 <= amount <= 100_000:
            await ctx.send("Give an amount between 0 and 100000.")
            return
        await self.config.guild(ctx.guild).pot_daily_topup.set(amount)
        await ctx.tick()

    @crackpotset.command(name="crackchance")
    async def crackpotset_crackchance(self, ctx: commands.Context, percent: float):
        """Odds (0-100%) that a daily crack attempt wins the pot."""
        if not 0 <= percent <= 100:
            await ctx.send("Give a percentage between 0 and 100.")
            return
        await self.config.guild(ctx.guild).pot_win_chance.set(percent / 100)
        await ctx.tick()

    @crackpotset.command(name="migratecuff", hidden=True)
    @checks.is_owner()
    async def crackpotset_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = NODE_DATA_DEFAULT
    ):
        """Migrate the pot from the Node CuffBot data file. Use `preview` to dry-run."""
        preview = mode.lower() == "preview"
        try:
            data = json.loads(Path(path).read_text())
        except (OSError, json.JSONDecodeError) as exc:
            await ctx.send(f"Could not read the Node data file: `{exc}`")
            return
        node_pot = data.get("economyPot")
        if not isinstance(node_pot, dict):
            await ctx.send("No `economyPot` found in the Node data — nothing to migrate.")
            return
        new_pot = {
            "balance": int(node_pot.get("balance", 0)),
            "last_topup_day": str(node_pot.get("lastTopUpDay", "") or ""),
            "attempts": {
                str(k): str(v) for k, v in (node_pot.get("attempts") or {}).items()
            },
        }
        if preview:
            await ctx.send(
                "Would write pot: balance **{balance}**, last top-up **{day}**, "
                "**{n}** attempt stamps.".format(
                    balance=new_pot["balance"],
                    day=new_pot["last_topup_day"] or "—",
                    n=len(new_pot["attempts"]),
                )
            )
            return
        async with self._lock_for(ctx.guild):
            await self.config.guild(ctx.guild).pot.set(new_pot)
        await ctx.send(
            f"Migrated the donut pot: **{_gold(new_pot['balance'])}**, "
            f"{len(new_pot['attempts'])} attempt stamps."
        )
