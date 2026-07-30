"""CuffRecords — the precinct archive.

Port of the CuffBot Node module ``src/modules/records``. Every enforcement
action lands on a member's rap sheet with a case number; ``[p]rapsheet`` reads
it and ``[p]expunge`` erases it.

The point of this cog is :meth:`CuffRecords.add_record`: it is the seam other
cogs file through, exactly as the Node module's ``lib/api.js`` was. CuffAffairs
calls it when a citation is issued. Without a filer the archive stays empty, so
``[p]filerecord`` exists too — a detainment or a release has no command of its
own anywhere else.
"""

import logging
import time
from typing import Any, Dict, List, Optional

import discord
from redbot.core import Config, checks, commands
from redbot.core.bot import Red

from .records import (
    RECORD_TYPES,
    TYPE_BADGES,
    build_entry,
    filter_for,
    format_rap_sheet,
    without,
)

log = logging.getLogger("red.cuff-cogs.cuffrecords")

EMBED_COLOR = 0xA65E6E
ERROR_COLOR = 0xED4245
SUCCESS_COLOR = 0x57F287


class CuffRecords(commands.Cog):
    """Rap sheets: every enforcement action on file with a case number."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175016, force_registration=True)
        self.config.register_guild(next_case_number=1, entries=[])

    async def red_delete_data_for_user(self, *, requester, user_id: int):
        """A rap sheet is end-user data — remove it on request, everywhere."""
        for guild in self.bot.guilds:
            async with self.config.guild(guild).entries() as entries:
                kept, _removed = without(entries, user_id)
                entries[:] = kept

    # ------------------------------------------------------------------
    # The API other cogs file through
    # ------------------------------------------------------------------

    async def add_record(
        self,
        guild: discord.Guild,
        *,
        record_type: str,
        user_id: int,
        officer_id: int,
        reason: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """File a record and return it with its case number stamped.

        Raises ``ValueError`` on an unknown type. Callers that must not fail
        because of the archive should catch it — see CuffAffairs.
        """
        group = self.config.guild(guild)
        async with group.entries() as entries:
            case_number = await group.next_case_number()
            entry = build_entry(
                case_number,
                record_type=record_type,
                user_id=user_id,
                officer_id=officer_id,
                reason=reason,
                at=time.time(),
                meta=meta,
            )
            entries.append(entry)
            await group.next_case_number.set(case_number + 1)
        return entry

    async def records_for(self, guild: discord.Guild, user_id: int) -> List[Dict[str, Any]]:
        """One member's records, oldest first."""
        return filter_for(await self.config.guild(guild).entries(), user_id)

    async def expunge_records(
        self, guild: discord.Guild, user_id: int, case_number: Optional[int] = None
    ) -> int:
        """Erase a member's records — all, or one case. Returns how many went."""
        async with self.config.guild(guild).entries() as entries:
            kept, removed = without(entries, user_id, case_number)
            entries[:] = kept
        return removed

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @commands.guild_only()
    @checks.mod_or_permissions(moderate_members=True)
    @commands.command(name="rapsheet", aliases=["record", "sheet"])
    async def rapsheet(self, ctx: commands.Context, member: discord.Member):
        """Pull up a member's record: citations, detainments, arrests, releases."""
        entries = await self.records_for(ctx.guild, member.id)
        await ctx.send(
            format_rap_sheet(member.display_name, entries),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @commands.guild_only()
    @checks.mod_or_permissions(moderate_members=True)
    @commands.command(name="filerecord", aliases=["logrecord"])
    async def filerecord(
        self,
        ctx: commands.Context,
        record_type: str,
        member: discord.Member,
        *,
        reason: Optional[str] = None,
    ):
        """File a record by hand: `citation`, `detainment`, `arrest` or `release`."""
        kind = record_type.strip().lower()
        if kind not in RECORD_TYPES:
            return await ctx.send(
                embed=discord.Embed(
                    color=ERROR_COLOR,
                    title="🚫 Unknown record type",
                    description="Pick one of: " + ", ".join(f"`{t}`" for t in RECORD_TYPES),
                )
            )
        entry = await self.add_record(
            ctx.guild,
            record_type=kind,
            user_id=member.id,
            officer_id=ctx.author.id,
            reason=reason,
        )
        embed = discord.Embed(
            color=EMBED_COLOR,
            title=f"{TYPE_BADGES[kind]} {kind.title()} filed",
            description=f"**Case** `#{entry['case_number']:04d}` · {member.mention}",
        )
        if reason:
            embed.add_field(name="Reason", value=reason[:1024], inline=False)
        embed.add_field(name="Officer", value=ctx.author.mention, inline=True)
        embed.set_footer(text=f"{ctx.clean_prefix}rapsheet {member.display_name} to read the sheet")
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())

    @commands.guild_only()
    @checks.admin_or_permissions(manage_guild=True)
    @commands.command(name="expunge")
    async def expunge(
        self, ctx: commands.Context, member: discord.Member, case_number: Optional[int] = None
    ):
        """Erase records from a member's rap sheet (irreversible).

        Erasing history sits a tier above day-to-day moderation, which is why
        this asks for Manage Server while `rapsheet` only needs a moderator.
        """
        if case_number is not None and case_number < 1:
            return await ctx.send(
                embed=discord.Embed(
                    color=ERROR_COLOR, title="🚫 Bad case number", description="Case numbers start at 1."
                )
            )
        removed = await self.expunge_records(ctx.guild, member.id, case_number)
        if removed == 0:
            description = (
                f"Case `#{case_number}` is not on **{member.display_name}**'s sheet."
                if case_number
                else f"**{member.display_name}** already has a clean sheet."
            )
            return await ctx.send(
                embed=discord.Embed(color=EMBED_COLOR, title="ℹ️ Nothing expunged",
                                    description=description)
            )
        description = (
            f"Case `#{case_number}` expunged from **{member.display_name}**'s record."
            if case_number
            else f"**{member.display_name}**'s rap sheet expunged — **{removed}** record(s) erased."
        )
        await ctx.send(
            embed=discord.Embed(color=SUCCESS_COLOR, title="🗑️ Expunged", description=description),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @commands.guild_only()
    @checks.mod_or_permissions(moderate_members=True)
    @commands.command(name="archive", aliases=["recordstats"])
    async def archive(self, ctx: commands.Context):
        """How full the archive is, by record type."""
        group = self.config.guild(ctx.guild)
        entries = await group.entries()
        next_case = await group.next_case_number()
        embed = discord.Embed(color=EMBED_COLOR, title="🗄️ The precinct archive")
        if not entries:
            embed.description = (
                "Nothing on file. Records arrive from `"
                + ctx.clean_prefix
                + "cite`, or by hand with `"
                + ctx.clean_prefix
                + "filerecord`."
            )
        else:
            counts: Dict[str, int] = {}
            for entry in entries:
                counts[entry["type"]] = counts.get(entry["type"], 0) + 1
            embed.description = "\n".join(
                f"{TYPE_BADGES.get(kind, '•')} **{count}** {kind}(s)"
                for kind, count in sorted(counts.items())
            )
            people = len({e["user_id"] for e in entries})
            embed.set_footer(
                text=f"{len(entries)} record(s) across {people} member(s) · next case #{next_case:04d}"
            )
        await ctx.send(embed=embed)
