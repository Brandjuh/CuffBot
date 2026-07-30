"""CuffBank — everybody in the precinct has an account, from day one.

Red opens a bank account **lazily**: the record only exists once something
touches it (a payday, a game, a `[p]balance`). Until then the member is not in
the bank at all, so they are missing from the leaderboard and every cog that
reads balances has to cope with a member who "isn't registered yet".

This cog closes that gap. New members get an account the moment they join, and
:command:`backfill` opens one for everyone already in the server.

The one rule everything here follows: **an existing balance is never touched.**
Opening an account reads the current balance and writes it straight back, so a
member who leaves and rejoins keeps what they had — otherwise leave/rejoin
would be a free reset to the starting amount. Levelling everyone up to a
minimum is a separate, explicit argument to :command:`backfill`.
"""

import asyncio
import logging
from typing import Optional, Tuple

import discord
from redbot.core import Config, bank, checks, commands, errors
from redbot.core.bot import Red

log = logging.getLogger("red.cuff-cogs.cuffbank")

EMBED_COLOR = 0xF1C40F
SUCCESS_COLOR = 0x57F287
ERROR_COLOR = 0xED4245

#: Yield to the event loop every N members so a big backfill cannot freeze the
#: bot on a Pi.
BACKFILL_CHUNK = 25


class CuffBank(commands.Cog):
    """Give every member a bank account automatically."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175014, force_registration=True)
        self.config.register_guild(enabled=True)

    async def red_delete_data_for_user(self, **kwargs):
        """Balances belong to Red's bank, which has its own deletion handling."""
        return

    # ------------------------------------------------------------------
    # The one operation everything else is built on
    # ------------------------------------------------------------------

    @staticmethod
    async def ensure_account(member: discord.Member, minimum: Optional[int] = None) -> Tuple[bool, int]:
        """Make sure ``member`` has a real, stored bank account.

        Returns ``(changed, balance)``. ``changed`` is True when this call
        actually wrote something — either it opened a brand new account, or it
        topped an existing one up to ``minimum``.

        Red has no "does this account exist" call, so the trick is that
        :func:`bank.get_balance` reports the *default* balance for an account
        that was never stored. Writing that value back is therefore a no-op for
        anyone who already has an account, and creates the record for anyone
        who does not.
        """
        current = await bank.get_balance(member)
        target = current if minimum is None else max(current, minimum)
        try:
            await bank.set_balance(member, target)
        except errors.BalanceTooHigh as error:
            await bank.set_balance(member, error.max_balance)
            return True, error.max_balance
        return target != current, target

    # ------------------------------------------------------------------
    # Listener
    # ------------------------------------------------------------------

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        if member.bot:
            return
        try:
            if not await self.config.guild(member.guild).enabled():
                return
            if await self.bot.cog_disabled_in_guild(self, member.guild):
                return
            # No minimum on join: a returning member keeps their old balance
            # rather than being handed the starting amount all over again.
            await self.ensure_account(member)
        except Exception:
            # Everything in here is defensive: a handler that can itself raise
            # would take the whole join event down with it.
            log.warning(
                "CuffBank: could not open an account for %s in %s",
                getattr(member, "id", "?"),
                getattr(getattr(member, "guild", None), "id", "?"),
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @commands.guild_only()
    @commands.group(name="cuffbank", aliases=["accounts"], invoke_without_command=True)
    async def cuffbank(self, ctx: commands.Context):
        """Automatic bank accounts for every member."""
        enabled = await self.config.guild(ctx.guild).enabled()
        is_global = await bank.is_global()
        default = await bank.get_default_balance(None if is_global else ctx.guild)
        currency = await bank.get_currency_name(None if is_global else ctx.guild)
        humans = [m for m in ctx.guild.members if not m.bot]
        registered = await self.count_accounts(ctx.guild)

        embed = discord.Embed(
            color=EMBED_COLOR,
            title="🏦 Automatic Accounts",
            description=(
                "Red only opens a bank account the first time something touches it. "
                "With this on, every member has one from the moment they join."
            ),
        )
        embed.add_field(
            name="On join", value="🟢 Enabled" if enabled else "🔴 Disabled", inline=True
        )
        embed.add_field(
            name="Starting balance", value=f"**{default:,} {currency}**", inline=True
        )
        embed.add_field(name="Bank", value="global" if is_global else "this server", inline=True)
        missing = max(0, len(humans) - registered)
        embed.add_field(
            name="Coverage",
            value=(
                f"**{registered}** of **{len(humans)}** members have an account"
                + (f"\n⚠️ **{missing}** still missing — run `{ctx.clean_prefix}cuffbank backfill`"
                   if missing else "\n✅ everyone is covered")
            ),
            inline=False,
        )
        embed.add_field(
            name="Commands",
            value=(
                f"`{ctx.clean_prefix}cuffbank amount <n>` — starting balance for new accounts\n"
                f"`{ctx.clean_prefix}cuffbank backfill [minimum]` — open accounts for everyone here\n"
                f"`{ctx.clean_prefix}cuffbank on` / `off` — the join listener"
            ),
            inline=False,
        )
        await ctx.send(embed=embed)

    @staticmethod
    async def count_accounts(guild: discord.Guild) -> int:
        """How many members of this guild actually have a stored account.

        ``get_leaderboard`` is the only public call that reports which accounts
        genuinely exist — every per-member call reports a default for members
        who have never been written to the bank.
        """
        try:
            stored = await bank.get_leaderboard(guild=guild)
        except TypeError:  # guild-specific bank without a guild — cannot happen here
            return 0
        member_ids = {m.id for m in guild.members if not m.bot}
        return sum(1 for uid, _account in stored if int(uid) in member_ids)

    @cuffbank.command(name="on")
    @checks.admin_or_permissions(manage_guild=True)
    async def cuffbank_on(self, ctx: commands.Context):
        """Open an account for every new member automatically."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await ctx.send(
            embed=discord.Embed(
                color=SUCCESS_COLOR,
                title="🟢 Automatic accounts on",
                description="New members get a bank account the moment they join.",
            )
        )

    @cuffbank.command(name="off")
    @checks.admin_or_permissions(manage_guild=True)
    async def cuffbank_off(self, ctx: commands.Context):
        """Stop opening accounts on join."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.send(
            embed=discord.Embed(
                color=EMBED_COLOR,
                title="🔴 Automatic accounts off",
                description="New members get an account the old way: the first time "
                "something touches their balance. Existing accounts are untouched.",
            )
        )

    @cuffbank.command(name="amount", aliases=["starting", "registeramount"])
    @checks.admin_or_permissions(manage_guild=True)
    @bank.is_owner_if_bank_global()
    async def cuffbank_amount(self, ctx: commands.Context, amount: int):
        """Starting balance for new accounts.

        This is Red's own `bankset registeramount` — set it here so the joining
        rule and the amount live in one place.
        """
        if amount < 0:
            return await ctx.send(
                embed=discord.Embed(
                    color=ERROR_COLOR,
                    title="🚫 Bad amount",
                    description="A starting balance cannot be negative.",
                )
            )
        is_global = await bank.is_global()
        max_balance = await bank.get_max_balance(None if is_global else ctx.guild)
        if amount > max_balance:
            return await ctx.send(
                embed=discord.Embed(
                    color=ERROR_COLOR,
                    title="🚫 Above the ceiling",
                    description=f"The bank's maximum balance is **{max_balance:,}**.",
                )
            )
        await bank.set_default_balance(amount, None if is_global else ctx.guild)
        currency = await bank.get_currency_name(None if is_global else ctx.guild)
        await ctx.send(
            embed=discord.Embed(
                color=SUCCESS_COLOR,
                title="✅ Starting balance set",
                description=(
                    f"New accounts open with **{amount:,} {currency}**.\n\n"
                    f"This applies to accounts opened from now on. To bring the members "
                    f"who are already here up to it, run "
                    f"`{ctx.clean_prefix}cuffbank backfill {amount}`."
                ),
            )
        )

    @cuffbank.command(name="backfill")
    @checks.admin_or_permissions(manage_guild=True)
    async def cuffbank_backfill(self, ctx: commands.Context, minimum: Optional[int] = None):
        """Open an account for every member who does not have one.

        Pass `minimum` to also top every account up to at least that amount —
        nobody ever loses currency, balances above it are left alone. With no
        argument, existing balances are not touched at all.
        """
        is_global = await bank.is_global()
        if minimum is not None:
            if minimum < 0:
                return await ctx.send(
                    embed=discord.Embed(
                        color=ERROR_COLOR,
                        title="🚫 Bad amount",
                        description="A minimum cannot be negative.",
                    )
                )
            max_balance = await bank.get_max_balance(None if is_global else ctx.guild)
            if minimum > max_balance:
                return await ctx.send(
                    embed=discord.Embed(
                        color=ERROR_COLOR,
                        title="🚫 Above the ceiling",
                        description=f"The bank's maximum balance is **{max_balance:,}**.",
                    )
                )

        humans = [m for m in ctx.guild.members if not m.bot]
        before = await self.count_accounts(ctx.guild)
        opened = topped = failed = 0

        async with ctx.typing():
            for index, member in enumerate(humans, start=1):
                try:
                    changed, _balance = await self.ensure_account(member, minimum)
                except Exception:
                    failed += 1
                    log.warning("CuffBank: backfill failed for %s", member.id, exc_info=True)
                    continue
                if changed:
                    topped += 1
                if index % BACKFILL_CHUNK == 0:
                    await asyncio.sleep(0)  # let the rest of the bot breathe

        after = await self.count_accounts(ctx.guild)
        opened = max(0, after - before)
        currency = await bank.get_currency_name(None if is_global else ctx.guild)

        embed = discord.Embed(color=SUCCESS_COLOR, title="🏦 Backfill complete")
        embed.add_field(name="Members", value=f"**{len(humans)}**", inline=True)
        embed.add_field(name="Accounts opened", value=f"**{opened}**", inline=True)
        embed.add_field(
            name="Balances raised" if minimum is not None else "Already had one",
            value=f"**{topped}**" if minimum is not None else f"**{len(humans) - opened}**",
            inline=True,
        )
        if minimum is not None:
            embed.description = (
                f"Everyone now holds at least **{minimum:,} {currency}**. "
                "Nobody's balance went down."
            )
        else:
            embed.description = "Every member now has an account. No balance was changed."
        if failed:
            embed.add_field(
                name="⚠️ Failed",
                value=f"**{failed}** member(s) — see the log",
                inline=False,
            )
        embed.set_footer(text=f"{after} of {len(humans)} members have an account")
        await ctx.send(embed=embed)
