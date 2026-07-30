"""CuffEmbed — the stock cogs' plain text, posted as embeds.

Every cog in `cuff-cogs` answers in embeds; the stock and third-party cogs do
not. `!payday` (Red's core ``economy``) and `!freecredits …` (YamiCogs' ``payday``)
send bare strings, and those are upstream files: editing them there means the
change disappears with the next cog update.

This cog closes the gap from the outside. It wraps the two methods every cog
sends through (see :mod:`cuffembed.wrap`) and re-renders the reply as an embed —
with a title and colour for the messages it recognises, and a plain precinct-gold
box for everything else. Only cogs on the allow-list are touched, so widening the
coverage is `!cuffembed add <cog>` rather than new code.

Two deliberate defaults, both switchable:

* **Pings off.** A mention inside an embed renders but never pings, and the
  precinct's other announcements are no-ping too. `!cuffembed ping on` lifts a
  leading mention out of the text and sends it alongside the embed instead.
* **Event messages on.** A cash drop or a heist announcement is posted straight
  to a channel without a command behind it; those get embeds as well.
"""

import logging
from typing import Optional, Set

import discord
from redbot.core import Config, checks, commands
from redbot.core.bot import Red

from . import wrap

log = logging.getLogger("red.cuff-cogs.cuffembed")

#: The cogs wrapped out of the box: the economy family, where the plain-text
#: replies members actually read live. Everything else is opt-in.
DEFAULT_COGS = [
    "economy",  # Red core: !payday, !balance, !bank, !slot
    "payday",  # YamiCogs: !freecredits, !pdconfig
    "cashdrop",
    "extendedeconomy",
    "heist",
    "city",
    "simplecasino",
]

#: The messages `!cuffembed preview` renders, so the owner can see the result
#: without waiting out a payday cooldown. Verbatim shapes from the two cogs.
PREVIEW_SAMPLES = (
    (
        "!payday",
        "<@{owner}> Here, take some donuts. Enjoy! (+250 donuts!)\n\n"
        "You currently have 12,750 donuts.\n\n"
        "You are currently #4 on the global leaderboard!",
    ),
    ("!payday (cooldown)", "<@{owner}> Too soon. Your next payday is in 3 hours."),
    (
        "!freecredits all",
        "You have claimed all available donuts from the `freecredits` program! +900 donuts\n"
        "Plus an additional 100 for maintaining your streaks",
    ),
    ("!freecredits daily", "Sorry, you still have 6 hours until your next daily bonus"),
    ("unrecognised message", "Some other cog said something the rule table does not know."),
)


class CuffEmbed(commands.Cog):
    """Post the stock cogs' plain-text messages as embeds."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175015, force_registration=True)
        # Global, not per-guild, on purpose: the channel-send path fires from
        # code that has no guild context, and this instance is single-guild
        # anyway (home precinct 411157175948541954).
        self.config.register_global(
            enabled=True,
            events=True,
            ping=False,
            color=None,
            cogs=DEFAULT_COGS,
        )
        # The channel-send path has to know the allow-list *synchronously* (it
        # decides whether a message is even interesting before it may await), so
        # the list is mirrored here and refreshed on every write.
        self._keys = {name.lower() for name in DEFAULT_COGS}

    async def cog_load(self):
        await self._refresh_keys()
        wrap.install(self)

    def cog_unload(self):
        wrap.remove()

    async def _refresh_keys(self) -> None:
        self._keys = {str(name).lower() for name in await self.config.cogs()}

    async def red_delete_data_for_user(self, **kwargs):
        """Nothing here is stored per user."""
        return

    # ------------------------------------------------------------------
    # The policy the wrapper asks
    # ------------------------------------------------------------------

    def allowed_keys(self) -> Set[str]:
        """The allow-list, without awaiting.

        The wrapper's channel-send path calls this on every send to decide
        whether the caller is even interesting, so it reads the mirror kept by
        :meth:`_refresh_keys` rather than Config.
        """
        return self._keys

    async def plan(self, destination, content, kwargs: dict, keys: Set[str], *, via_context: bool):
        """Decide whether this message becomes an embed, and what it looks like."""
        conf = await self.config.all()
        if not conf["enabled"]:
            return None
        if not via_context and not conf["events"]:
            return None
        allowed = {str(name).lower() for name in conf["cogs"]}
        if not keys or not (keys & allowed):
            return None
        if not wrap.should_embed(content, kwargs):
            return None
        if not wrap.can_embed(destination):
            return None
        return wrap.build_embed(
            content,
            conf["color"] if conf["color"] is not None else wrap.NEUTRAL,
            ping=conf["ping"],
        )

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @commands.group(name="cuffembed", aliases=["embedwrap"], invoke_without_command=True)
    @checks.admin_or_permissions(manage_guild=True)
    async def cuffembed(self, ctx: commands.Context):
        """Post other cogs' plain-text messages as embeds."""
        conf = await self.config.all()
        loaded = {name.lower() for name in self.bot.cogs}
        loaded |= {
            key
            for cog in self.bot.cogs.values()
            for key in wrap.cog_keys(cog)
        }

        covered = "\n".join(
            f"{'✅' if name.lower() in loaded else '⚠️'} `{name}`"
            for name in sorted(conf["cogs"])
        ) or "_none — nothing is being wrapped_"

        color = conf["color"] if conf["color"] is not None else wrap.NEUTRAL
        embed = discord.Embed(
            color=color,
            title="🖼️ Embed wrapper",
            description=(
                "Stock cogs answer in plain text. With this on, their replies are "
                "re-rendered as embeds on the way out — no upstream file is edited, "
                "so a cog update cannot undo it."
            ),
        )
        embed.add_field(
            name="Status",
            value=("🟢 Enabled" if conf["enabled"] else "🔴 Disabled")
            + ("" if wrap.is_installed() else "\n⚠️ hook not installed — reload the cog"),
            inline=True,
        )
        embed.add_field(
            name="Event messages",
            value="🟢 Wrapped" if conf["events"] else "🔴 Left alone",
            inline=True,
        )
        embed.add_field(
            name="Pings",
            value="🔔 Kept" if conf["ping"] else "🔇 Silent",
            inline=True,
        )
        embed.add_field(name="Covered cogs", value=covered, inline=False)
        embed.add_field(
            name="Commands",
            value=(
                f"`{ctx.clean_prefix}cuffembed on` / `off` — the whole wrapper\n"
                f"`{ctx.clean_prefix}cuffembed add <cog…>` / `remove <cog…>` — which cogs\n"
                f"`{ctx.clean_prefix}cuffembed events on|off` — messages without a command\n"
                f"`{ctx.clean_prefix}cuffembed ping on|off` — keep the mention as a real ping\n"
                f"`{ctx.clean_prefix}cuffembed color <hex>` — colour for unrecognised messages\n"
                f"`{ctx.clean_prefix}cuffembed preview` — see the payday messages rendered\n"
                f"`{ctx.clean_prefix}cuffembed test <text>` — render any line"
            ),
            inline=False,
        )
        embed.set_footer(text=f"Default colour #{color:06X} · rules: {len(wrap.RULES)}")
        await ctx.send(embed=embed)

    @cuffembed.command(name="on")
    @checks.is_owner()
    async def cuffembed_on(self, ctx: commands.Context):
        """Start wrapping the covered cogs' messages."""
        await self.config.enabled.set(True)
        await ctx.send(
            embed=discord.Embed(
                color=wrap.GREEN,
                title="🟢 Embed wrapper on",
                description="The covered cogs' plain-text messages are posted as embeds.",
            )
        )

    @cuffembed.command(name="off")
    @checks.is_owner()
    async def cuffembed_off(self, ctx: commands.Context):
        """Leave every cog's messages exactly as they are."""
        await self.config.enabled.set(False)
        await ctx.send(
            embed=discord.Embed(
                color=wrap.NEUTRAL,
                title="🔴 Embed wrapper off",
                description=(
                    "Every cog sends its own text again. The hook stays in place "
                    "(unload the cog to remove it entirely)."
                ),
            )
        )

    @cuffembed.command(name="add")
    @checks.is_owner()
    async def cuffembed_add(self, ctx: commands.Context, *cogs: str):
        """Wrap one or more extra cogs.

        Name the cog the way `!cogs` shows it or the way it was loaded —
        `CuffEmbed` and `cuffembed` both work.
        """
        if not cogs:
            return await ctx.send_help()
        current = set(await self.config.cogs())
        added = sorted({self._normalise(name) for name in cogs} - current)
        if not added:
            return await ctx.send(
                embed=discord.Embed(
                    color=wrap.NEUTRAL,
                    title="ℹ️ Nothing to add",
                    description="Those cogs are already covered.",
                )
            )
        await self.config.cogs.set(sorted(current | set(added)))
        await self._refresh_keys()
        await ctx.send(
            embed=discord.Embed(
                color=wrap.GREEN,
                title="✅ Now wrapped",
                description="\n".join(f"`{name}`" for name in added),
            )
        )

    @cuffembed.command(name="remove", aliases=["delete", "del"])
    @checks.is_owner()
    async def cuffembed_remove(self, ctx: commands.Context, *cogs: str):
        """Stop wrapping one or more cogs."""
        if not cogs:
            return await ctx.send_help()
        current = set(await self.config.cogs())
        removed = sorted(current & {self._normalise(name) for name in cogs})
        if not removed:
            return await ctx.send(
                embed=discord.Embed(
                    color=wrap.NEUTRAL,
                    title="ℹ️ Nothing to remove",
                    description="None of those cogs were being wrapped.",
                )
            )
        await self.config.cogs.set(sorted(current - set(removed)))
        await self._refresh_keys()
        await ctx.send(
            embed=discord.Embed(
                color=wrap.ORANGE,
                title="🔴 No longer wrapped",
                description="\n".join(f"`{name}`" for name in removed),
            )
        )

    @cuffembed.command(name="events")
    @checks.is_owner()
    async def cuffembed_events(self, ctx: commands.Context, toggle: bool):
        """Also wrap messages that no command asked for (drops, announcements)."""
        await self.config.events.set(toggle)
        await ctx.send(
            embed=discord.Embed(
                color=wrap.GREEN if toggle else wrap.NEUTRAL,
                title="🟢 Event messages wrapped" if toggle else "🔴 Event messages left alone",
                description=(
                    "A cash drop or an announcement posted straight into a channel "
                    "becomes an embed too."
                    if toggle
                    else "Only replies to a command are wrapped."
                ),
            )
        )

    @cuffembed.command(name="ping")
    @checks.is_owner()
    async def cuffembed_ping(self, ctx: commands.Context, toggle: bool):
        """Keep the mention as a real ping instead of silent text."""
        await self.config.ping.set(toggle)
        await ctx.send(
            embed=discord.Embed(
                color=wrap.GREEN if toggle else wrap.NEUTRAL,
                title="🔔 Pings kept" if toggle else "🔇 Pings silent",
                description=(
                    "A mention at the start of the message is sent alongside the embed, "
                    "so the member is actually pinged."
                    if toggle
                    else "Mentions stay inside the embed, where they render but never ping."
                ),
            )
        )

    @cuffembed.command(name="color", aliases=["colour"])
    @checks.is_owner()
    async def cuffembed_color(self, ctx: commands.Context, color: Optional[str] = None):
        """Colour for messages the rule table does not recognise.

        Give a hex value like `#f1c40f`, or nothing to go back to precinct gold.
        Recognised messages (a payout, a cooldown, a refusal) keep their own colour.
        """
        if color is None:
            await self.config.color.set(None)
            return await ctx.send(
                embed=discord.Embed(
                    color=wrap.NEUTRAL,
                    title="✅ Colour reset",
                    description=f"Back to precinct gold (`#{wrap.NEUTRAL:06X}`).",
                )
            )
        try:
            value = int(color.lstrip("#"), 16)
        except ValueError:
            value = -1
        if not 0 <= value <= 0xFFFFFF:
            return await ctx.send(
                embed=discord.Embed(
                    color=wrap.RED,
                    title="🚫 Not a colour",
                    description="Give a hex value, for example `#f1c40f`.",
                )
            )
        await self.config.color.set(value)
        await ctx.send(
            embed=discord.Embed(
                color=value,
                title="✅ Colour set",
                description=f"Unrecognised messages now use `#{value:06X}`.",
            )
        )

    @cuffembed.command(name="preview")
    @checks.admin_or_permissions(manage_guild=True)
    async def cuffembed_preview(self, ctx: commands.Context):
        """Show the payday messages exactly as they will be posted."""
        conf = await self.config.all()
        default = conf["color"] if conf["color"] is not None else wrap.NEUTRAL
        for label, sample in PREVIEW_SAMPLES:
            text = sample.format(owner=ctx.author.id)
            embed, ping_content = wrap.build_embed(text, default, ping=conf["ping"])
            embed.set_footer(text=f"preview · {label}")
            await ctx.send(
                content=ping_content,
                embed=embed,
                allowed_mentions=discord.AllowedMentions.none(),
            )

    @cuffembed.command(name="test")
    @checks.admin_or_permissions(manage_guild=True)
    async def cuffembed_test(self, ctx: commands.Context, *, text: str):
        """Render any line the way the wrapper would."""
        conf = await self.config.all()
        default = conf["color"] if conf["color"] is not None else wrap.NEUTRAL
        embed, ping_content = wrap.build_embed(text, default, ping=conf["ping"])
        rule = wrap.match_rule(text)
        embed.set_footer(text=f"test · rule: {rule.title if rule and rule.title else 'none'}")
        await ctx.send(
            content=ping_content,
            embed=embed,
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @staticmethod
    def _normalise(name: str) -> str:
        return name.strip().strip("`").lower()
