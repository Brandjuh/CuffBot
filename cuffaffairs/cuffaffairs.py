"""CuffAffairs — police-themed fun and image commands for CuffBot.

Ported from the Node.js CuffBot's public-affairs and enforcement modules:
WANTED posters, officer badges, donuts, citizen reports, and Papers-Please
style citation tickets.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
from datetime import datetime, timezone
from io import BytesIO
from typing import Optional

import discord
from redbot.core import Config, checks, commands

from . import render

log = logging.getLogger("red.cuff-cogs.cuffaffairs")

#: Live data file of the legacy Node.js CuffBot, read by ``migratecuff``.
LEGACY_DATA_PATH = "/home/brand/CuffBot/data/411157175948541954.json"


class CuffAffairs(commands.Cog):
    """Police-themed fun: WANTED posters, badges, donuts, 911 reports, and citations."""

    def __init__(self, bot):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175006, force_registration=True)
        self.config.register_guild(log_channel_id=None)

    async def red_delete_data_for_user(self, *, requester, user_id: int):
        # This cog stores no end-user data (only a per-guild log channel id),
        # so there is nothing to delete.
        return

    # --- helpers ---------------------------------------------------------

    async def _log_channel(self, guild: discord.Guild) -> Optional[discord.TextChannel]:
        channel_id = await self.config.guild(guild).log_channel_id()
        if not channel_id:
            return None
        channel = guild.get_channel(int(channel_id))
        return channel if isinstance(channel, (discord.TextChannel, discord.Thread)) else None

    @staticmethod
    async def _delete_quietly(message: discord.Message) -> None:
        try:
            await message.delete()
        except (discord.Forbidden, discord.HTTPException):
            pass

    async def _fetch_avatar(self, member: discord.Member) -> Optional[bytes]:
        """Fetch the member's avatar as static PNG bytes; None on failure."""
        try:
            asset = member.display_avatar.replace(format="png", size=512)
            return await asset.read()
        except Exception:
            log.debug("Avatar fetch failed for %s", member.id, exc_info=True)
            return None

    # --- fun commands ------------------------------------------------------

    @commands.guild_only()
    @commands.command()
    async def wanted(self, ctx: commands.Context, member: discord.Member, *, crime: str = None):
        """Put up a WANTED poster for a member — with their photo in the middle."""
        async with ctx.typing():
            chosen_crime = (crime or render.pick_crime(member.id))[:150]
            bounty = render.pick_bounty(member.id)
            avatar_bytes = await self._fetch_avatar(member)
            png = await asyncio.to_thread(
                render.render_wanted_poster, member.display_name, chosen_crime, bounty, avatar_bytes
            )
        await ctx.send(
            content=member.mention,
            file=discord.File(BytesIO(png), filename="wanted.png"),
            allowed_mentions=discord.AllowedMentions(users=[member]),
        )

    @commands.guild_only()
    @commands.command()
    async def badge(self, ctx: commands.Context, member: discord.Member = None):
        """Show a member's badge: rank, record, and time on the force."""
        member = member or ctx.author

        # Rank and record are best-effort — a missing or broken cog must
        # never break the badge; degrade silently.
        rank_name = "Unranked"
        try:
            levels = self.bot.get_cog("CuffLevels")
            if levels is not None and hasattr(levels, "current_rank_name"):
                result = levels.current_rank_name(member)
                if inspect.isawaitable(result):
                    result = await result
                if result:
                    rank_name = str(result)
        except Exception:
            log.debug("Badge: rank lookup failed", exc_info=True)

        record = "\N{EM DASH}"
        try:
            warnings_cog = self.bot.get_cog("Warnings")
            if warnings_cog is not None and hasattr(warnings_cog, "config"):
                warnings = await warnings_cog.config.member(member).warnings()
                count = len(warnings)
                record = f"{count} {'entry' if count == 1 else 'entries'}"
        except Exception:
            log.debug("Badge: record lookup failed", exc_info=True)

        joined = (
            f"<t:{int(member.joined_at.timestamp())}:D>" if member.joined_at else "unknown"
        )

        embed = discord.Embed(
            title=f"\N{IDENTIFICATION CARD} Officer Badge — {member.display_name}",
            color=0x5A86C9,
        )
        embed.set_thumbnail(url=member.display_avatar.url)
        embed.add_field(name="Rank", value=rank_name, inline=True)
        embed.add_field(name="Record", value=record, inline=True)
        embed.add_field(name="On the force since", value=joined, inline=True)
        await ctx.send(embed=embed)

    @commands.guild_only()
    @commands.command()
    async def donut(self, ctx: commands.Context, member: discord.Member = None):
        """Hand someone a donut from the break room. 🍩"""
        target = member or ctx.author
        donut = render.pick_donut(f"{ctx.author.id}:{target.id}")
        if target.id == ctx.author.id:
            await ctx.send(
                f"🍩 {ctx.author.mention} treats themselves to {donut}. Well earned, officer."
            )
        else:
            await ctx.send(f"🍩 {ctx.author.mention} hands {target.mention} {donut}.")

    @commands.guild_only()
    @commands.command(name="911")
    async def report_911(self, ctx: commands.Context, member: discord.Member, *, reason: str):
        """Report a member to the force. The report goes to the evidence locker.

        End the reason with the word `anonymous` to hide your name.
        """
        anonymous = False
        words = reason.split()
        if words and words[-1].lower() == "anonymous":
            anonymous = True
            reason = " ".join(words[:-1])

        channel = await self._log_channel(ctx.guild)
        if channel is None:
            await self._delete_quietly(ctx.message)
            await ctx.send(
                "🚨 There is no evidence-locker channel configured, so the force "
                f"cannot receive reports. Ask an admin to run `{ctx.clean_prefix}affairsset logchannel`."
            )
            return

        embed = discord.Embed(
            title="🚨 911 — Citizen Report",
            color=0xCC3A3A,
            description=f"**Reported:** {member.mention} ({member.id})",
        )
        embed.add_field(name="Reason", value=reason.strip() or "No reason given", inline=False)
        embed.add_field(
            name="Reporter", value="_Anonymous_" if anonymous else ctx.author.mention, inline=True
        )

        try:
            await channel.send(embed=embed)
        except discord.HTTPException:
            await ctx.send("🚨 Could not deliver the report to the evidence locker.")
            return

        # Remove the report from the public channel so the reporter (and the
        # accusation) is not left on display, then confirm briefly.
        await self._delete_quietly(ctx.message)
        await ctx.send(
            "🚨 Report filed with the force. Thank you — an officer will review it.",
            delete_after=8,
        )

    @commands.guild_only()
    @commands.command()
    async def fine(self, ctx: commands.Context, member: discord.Member, *, reason: str):
        """Issue a playful citation to anyone — just for laughs, no real consequences."""
        if member.id == ctx.me.id:
            await ctx.send("🍩 Nice try — you cannot fine the police.")
            return
        async with ctx.typing():
            gif = await asyncio.to_thread(
                render.render_citation_gif,
                member.display_name,
                reason,
                "PAY UP IN DONUTS",
                ctx.author.display_name,
                datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                str(member.id),
            )
        await ctx.send(
            content=(
                f"🎟️ {ctx.author.mention} slapped {member.mention} with a citation — "
                f"all in good fun. Reason: {reason}"
            ),
            file=discord.File(BytesIO(gif), filename="citation.gif"),
            # Reason is user text — only let the two people named ping.
            allowed_mentions=discord.AllowedMentions(users=[ctx.author, member]),
        )

    @commands.guild_only()
    @checks.mod_or_permissions(moderate_members=True)
    @commands.command()
    async def cite(self, ctx: commands.Context, member: discord.Member, *, reason: str):
        """Issue a formal citation (warning) — delivered as a pink-slip ticket."""
        async with ctx.typing():
            gif = await asyncio.to_thread(
                render.render_citation_gif,
                member.display_name,
                reason,
                "OFFICIAL WARNING",
                ctx.author.display_name,
                datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                str(member.id),
            )

        warned = await self._file_warning(ctx, member, reason)

        content = f"📋 Citation issued to {member.mention}. Reason: {reason}"
        if not warned:
            content += " (warning not filed)"
        await ctx.send(
            content=content,
            file=discord.File(BytesIO(gif), filename="citation.gif"),
            allowed_mentions=discord.AllowedMentions(users=[member]),
        )

        # Mirror a copy to the evidence locker, best-effort.
        channel = await self._log_channel(ctx.guild)
        if channel is not None:
            embed = discord.Embed(
                title="📋 Citation issued",
                color=0xA65E6E,
                description=f"**Cited:** {member.mention} ({member.id})",
            )
            embed.add_field(name="Reason", value=reason, inline=False)
            embed.add_field(name="Officer", value=ctx.author.mention, inline=True)
            embed.add_field(
                name="Warning", value="Filed" if warned else "Not filed", inline=True
            )
            try:
                await channel.send(embed=embed)
            except discord.HTTPException:
                log.debug("Cite: evidence-locker mirror failed", exc_info=True)

    async def _file_warning(
        self, ctx: commands.Context, member: discord.Member, reason: str
    ) -> bool:
        """Register a real warning through the Warnings cog. Returns success.

        The core Warnings cog's command is ``warn(ctx, user, points=1, *,
        reason)`` — the signature is verified before invoking so a changed or
        third-party ``warn`` command cannot be called with the wrong kwargs.
        """
        try:
            warn_cmd = self.bot.get_command("warn")
            if warn_cmd is None:
                return False
            params = inspect.signature(warn_cmd.callback).parameters
            if not {"user", "points", "reason"} <= set(params):
                log.warning("Cite: 'warn' command has an unexpected signature; not invoking.")
                return False
            await ctx.invoke(warn_cmd, user=member, points=1, reason=reason)
            return True
        except Exception:
            log.warning("Cite: filing the warning failed.", exc_info=True)
            return False

    # --- settings ----------------------------------------------------------

    @commands.guild_only()
    @checks.admin_or_permissions(manage_guild=True)
    @commands.group()
    async def affairsset(self, ctx: commands.Context):
        """Configure CuffAffairs."""

    @affairsset.command(name="status")
    async def affairsset_status(self, ctx: commands.Context):
        """Show the current CuffAffairs settings."""
        channel = await self._log_channel(ctx.guild)
        channel_id = await self.config.guild(ctx.guild).log_channel_id()
        if channel is not None:
            value = channel.mention
        elif channel_id:
            value = f"`{channel_id}` (channel not found)"
        else:
            value = "not set"
        embed = discord.Embed(title="CuffAffairs settings", color=0x5A86C9)
        embed.add_field(name="Evidence locker (log channel)", value=value, inline=False)
        await ctx.send(embed=embed)

    @affairsset.command(name="logchannel")
    async def affairsset_logchannel(self, ctx: commands.Context, channel: discord.TextChannel):
        """Set the evidence-locker channel for 911 reports and citation copies."""
        await self.config.guild(ctx.guild).log_channel_id.set(channel.id)
        await ctx.send(f"Evidence locker set to {channel.mention}.")

    @affairsset.command(name="nologchannel")
    async def affairsset_nologchannel(self, ctx: commands.Context):
        """Clear the evidence-locker channel."""
        await self.config.guild(ctx.guild).log_channel_id.set(None)
        await ctx.send("Evidence locker cleared.")

    @checks.is_owner()
    @affairsset.command(name="migratecuff")
    async def affairsset_migratecuff(self, ctx: commands.Context, mode: str = "apply"):
        """Migrate settings from the legacy Node.js CuffBot data file.

        Use `migratecuff preview` to see what would change without applying.
        """
        try:
            with open(LEGACY_DATA_PATH, encoding="utf-8") as fp:
                data = json.load(fp)
        except (OSError, ValueError) as error:
            await ctx.send(f"Could not read the legacy data file: `{error}`")
            return

        locker_id = data.get("evidenceLockerChannelId")
        if not locker_id:
            await ctx.send("Legacy data has no `evidenceLockerChannelId` — nothing to migrate.")
            return

        channel = ctx.guild.get_channel(int(locker_id))
        label = channel.mention if channel else f"`{locker_id}` (channel not found here)"
        if mode.lower() == "preview":
            await ctx.send(f"Preview — would set the evidence locker to {label}. Nothing applied.")
            return

        await self.config.guild(ctx.guild).log_channel_id.set(int(locker_id))
        await ctx.send(f"Migrated: evidence locker set to {label}.")
