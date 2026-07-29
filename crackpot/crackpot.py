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
    "heist_amount": 500,          # stake/loot per attempt
    "heist_cooldown_ms": 10_800_000,  # 3 hours
    "pot_daily_topup": 500,
    "pot_win_chance": 0.005,      # 0.5%
    "pot": {"balance": 0, "last_topup_day": "", "attempts": {}},
}

DEFAULT_MEMBER = {"last_heist_at": 0}


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
        for guild_id in all_members:
            await self.config.member_from_ids(guild_id, user_id).clear()
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
        """Try to steal donuts from another officer. 30% odds — get busted and your stake goes into the pot."""
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
        last = await self.config.member(ctx.author).last_heist_at()
        cooldown = conf["heist_cooldown_ms"]
        if last and now_ms - last < cooldown:
            wait = _format_wait_ms(cooldown - (now_ms - last))
            await ctx.send(
                f"🕶️ Lay low, officer — internal affairs is still watching. "
                f"Next attempt in **{wait}**."
            )
            return

        # Stamp the cooldown BEFORE the roll: a failed roll still costs the cooldown.
        await self.config.member(ctx.author).last_heist_at.set(now_ms)

        amount = conf["heist_amount"]
        if random.random() < conf["heist_chance"]:
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
            embed = discord.Embed(title="🕶️ HEIST!", description=desc, color=0x2ECC71)
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
                f"Steal odds: **{conf['heist_chance'] * 100:g}%**, stake/loot "
                f"**{_gold(conf['heist_amount'])}**, cooldown "
                f"**{_format_wait_ms(conf['heist_cooldown_ms'])}**",
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
        await self.config.guild(ctx.guild).heist_chance.set(percent / 100)
        await ctx.tick()

    @crackpotset.command(name="stealamount")
    async def crackpotset_stealamount(self, ctx: commands.Context, amount: commands.positive_int):
        """Donuts staked/looted per steal attempt."""
        await self.config.guild(ctx.guild).heist_amount.set(int(amount))
        await ctx.tick()

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
