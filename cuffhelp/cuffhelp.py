"""CuffHelp — the help desk: a button panel instead of a wall of cog names.

``[p]help`` opens a panel with one button per category (Moderation, Games,
Information…). Pressing one lists that category's commands with a one-line
explanation of each, paginated when it does not fit.

Only the bot-level help is replaced. ``[p]help <command>`` and
``[p]help <cog>`` fall through to Red's own formatter untouched, so command
signatures, aliases, subcommand listings, "command not found" fuzzy search and
every ``[p]helpset`` option keep behaving exactly as they always did.

Commands are filtered per viewer with Red's own ``help_filter_func``: the panel
never shows a command the presser could not run anyway, and category buttons
for categories that end up empty are not rendered at all.

.. warning::
    This cog replaces Red's help formatter. Do not load a second cog that does
    the same. ``[p]helpmenu off`` hands the formatter back without unloading.
"""

import logging
from typing import Dict, List, Optional, Tuple

import discord
from redbot.core import Config, checks, commands
from redbot.core.bot import Red
from redbot.core.commands.help import HelpSettings, RedHelpFormatter

from .categories import (
    ADMIN,
    DEFAULT_CATEGORIES,
    OTHER,
    build_lookup,
    category_of,
    emoji_for,
    is_admin_command,
    order_categories,
    paginate,
    short_doc,
)

log = logging.getLogger("red.cuff-cogs.cuffhelp")

#: Discord allows 5 rows of 5 components. The last row is the navigation bar,
#: so categories get four rows.
MAX_CATEGORY_BUTTONS = 20


class HelpPanel(discord.ui.View):
    """The panel itself: category buttons plus a navigation row.

    State is (category, page). "Home" is category ``None``. The message is
    edited in place rather than re-sent, so the panel never floods a channel.
    """

    def __init__(
        self,
        ctx: commands.Context,
        buckets: Dict[str, List[str]],
        *,
        timeout: float,
        tagline: str,
        color: discord.Color,
    ):
        super().__init__(timeout=timeout)
        self.ctx = ctx
        self.buckets = buckets
        self.tagline = tagline
        self.color = color
        self.message: Optional[discord.Message] = None
        self.category: Optional[str] = None
        self.page = 0
        self._pages: List[str] = []

        self.order = order_categories(list(buckets))[:MAX_CATEGORY_BUTTONS]
        for index, name in enumerate(self.order):
            button = discord.ui.Button(
                label=name,
                emoji=emoji_for(name),
                style=discord.ButtonStyle.secondary,
                row=index // 5,
                custom_id=f"cat:{name}",
            )
            button.callback = self._category_callback(name)
            self.add_item(button)

        nav_row = min(4, (len(self.order) + 4) // 5)
        self.prev_button = discord.ui.Button(
            label="Back", emoji="◀", style=discord.ButtonStyle.primary, row=nav_row, disabled=True
        )
        self.home_button = discord.ui.Button(
            label="Home", emoji="🏠", style=discord.ButtonStyle.success, row=nav_row, disabled=True
        )
        self.next_button = discord.ui.Button(
            label="Next", emoji="▶", style=discord.ButtonStyle.primary, row=nav_row, disabled=True
        )
        self.close_button = discord.ui.Button(
            label="Close", emoji="✖", style=discord.ButtonStyle.danger, row=nav_row
        )
        self.prev_button.callback = self._step(-1)
        self.next_button.callback = self._step(+1)
        self.home_button.callback = self._go_home
        self.close_button.callback = self._close
        for item in (self.prev_button, self.home_button, self.next_button, self.close_button):
            self.add_item(item)

    # -- guards ---------------------------------------------------------

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.ctx.author.id:
            await interaction.response.send_message(
                f"That help menu belongs to {self.ctx.author.display_name}. "
                f"Run `{self.ctx.clean_prefix}help` to open your own.",
                ephemeral=True,
            )
            return False
        return True

    async def on_timeout(self) -> None:
        for item in self.children:
            item.disabled = True
        if self.message is not None:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass

    # -- views ----------------------------------------------------------

    def home_embed(self) -> discord.Embed:
        embed = discord.Embed(
            title="📖 Help desk",
            description=(
                "Pick a category below to see its commands.\n"
                f"You only see what you are allowed to run here.\n\n{self.tagline}"
            ),
            color=self.color,
        )
        for name in self.order:
            count = len(self.buckets[name])
            embed.add_field(
                name=f"{emoji_for(name)} {name}",
                value=f"{count} command{'s' if count != 1 else ''}",
                inline=True,
            )
        return embed

    def category_embed(self) -> discord.Embed:
        total = max(1, len(self._pages))
        embed = discord.Embed(
            title=f"{emoji_for(self.category)} {self.category}",
            description=self._pages[self.page] if self._pages else "Nothing here.",
            color=self.color,
        )
        embed.set_footer(
            text=(
                f"Page {self.page + 1}/{total} · "
                f"{self.ctx.clean_prefix}help <command> for the full details"
            )
        )
        return embed

    def _sync_buttons(self) -> None:
        on_home = self.category is None
        self.home_button.disabled = on_home
        self.prev_button.disabled = on_home or self.page <= 0
        self.next_button.disabled = on_home or self.page >= len(self._pages) - 1
        for item in self.children:
            custom_id = getattr(item, "custom_id", "") or ""
            if custom_id.startswith("cat:"):
                selected = custom_id[4:] == self.category
                item.style = (
                    discord.ButtonStyle.primary if selected else discord.ButtonStyle.secondary
                )

    async def _render(self, interaction: discord.Interaction) -> None:
        self._sync_buttons()
        embed = self.home_embed() if self.category is None else self.category_embed()
        await interaction.response.edit_message(embed=embed, view=self)

    # -- callbacks ------------------------------------------------------

    def _category_callback(self, name: str):
        async def callback(interaction: discord.Interaction):
            self.category = name
            self.page = 0
            self._pages = paginate(self.buckets[name])
            await self._render(interaction)

        return callback

    def _step(self, delta: int):
        async def callback(interaction: discord.Interaction):
            self.page = max(0, min(len(self._pages) - 1, self.page + delta))
            await self._render(interaction)

        return callback

    async def _go_home(self, interaction: discord.Interaction) -> None:
        self.category = None
        self.page = 0
        self._pages = []
        await self._render(interaction)

    async def _close(self, interaction: discord.Interaction) -> None:
        self.stop()
        try:
            await interaction.response.edit_message(
                content="Help desk closed.", embed=None, view=None
            )
        except discord.HTTPException:
            pass


class CategoryHelpFormatter(RedHelpFormatter):
    """Red's formatter, with only the bot-level view replaced by the panel."""

    def __init__(self, cog: "CuffHelp"):
        super().__init__()
        self.cog = cog

    async def send_help(
        self, ctx: commands.Context, help_for=None, *, from_help_command: bool = False
    ):
        # Anything more specific than "the whole bot" is Red's job — command
        # signatures, cog pages, fuzzy not-found search all stay as they were.
        if help_for is not None:
            return await super().send_help(ctx, help_for, from_help_command=from_help_command)
        try:
            if await self.cog.panel_enabled(ctx) and await self.embed_requested(ctx):
                return await self.send_panel(ctx)
        except Exception:
            # A broken panel must never leave someone with no help at all.
            log.warning("Help panel failed; falling back to Red's menu", exc_info=True)
        return await super().send_help(ctx, help_for, from_help_command=from_help_command)

    async def send_panel(self, ctx: commands.Context) -> None:
        help_settings = await HelpSettings.from_context(ctx)
        buckets = await self.cog.build_buckets(ctx, help_settings)
        if not buckets:
            return await super().send_help(ctx, None, from_help_command=True)

        conf = await self.cog.config.all()
        view = HelpPanel(
            ctx,
            buckets,
            timeout=float(conf["timeout"]),
            tagline=help_settings.tagline or self.get_default_tagline(ctx),
            color=await ctx.embed_color(),
        )
        view.message = await ctx.send(embed=view.home_embed(), view=view)


class CuffHelp(commands.Cog):
    """A button-panel help menu, grouped by category."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175009, force_registration=True)
        self.config.register_global(
            enabled=True,
            timeout=180,
            #: cog name (lowercased) -> category, layered over the defaults
            overrides={},
            #: command name (lowercased) -> category; beats everything else
            command_overrides={},
            #: extra command names to treat as configuration, and names the
            #: naming rule should stop claiming
            admin_extra=[],
            admin_exclude=[],
        )
        self.formatter = CategoryHelpFormatter(self)
        self.bot.set_help_formatter(self.formatter)

    def cog_unload(self):
        # Hand the formatter back, or [p]help stays broken after an unload.
        self.bot.reset_help_formatter()

    async def red_delete_data_for_user(self, *, requester, user_id: int):
        """Nothing stored per user."""
        return

    async def panel_enabled(self, ctx: commands.Context) -> bool:
        return bool(await self.config.enabled())

    async def build_buckets(
        self, ctx: commands.Context, help_settings: HelpSettings
    ) -> Dict[str, List[str]]:
        """category → rendered command lines, filtered to what the viewer may run.

        Uses Red's own ``help_filter_func``, so ``[p]helpset showhidden`` and
        ``verifychecks`` keep meaning what they mean everywhere else.
        """
        conf = await self.config.all()
        lookup = build_lookup(DEFAULT_CATEGORIES, conf["overrides"])
        command_overrides = {k.lower(): v for k, v in conf["command_overrides"].items()}
        buckets: Dict[str, List[Tuple[str, str]]] = {}

        for cog_name, cog in (*sorted(self.bot.cogs.items()), (None, None)):
            # Bind the cog explicitly: the filter is lazy, and a closure over
            # the loop variable would resolve to whatever `cog` ended up as.
            iterator = filter(
                lambda c, _cog=cog: c.parent is None and c.cog is _cog, self.bot.commands
            )
            visible = [
                com
                async for com in RedHelpFormatter.help_filter_func(
                    ctx, iterator, help_settings=help_settings
                )
            ]
            if not visible:
                continue
            cog_category = category_of(cog_name, lookup)
            for command in sorted(visible, key=lambda c: c.qualified_name):
                name = command.qualified_name
                # Per-command placement beats the cog's, and configuration
                # beats both: `triviaset` belongs with the other settings, not
                # in Games with `trivia`.
                category = command_overrides.get(name.lower())
                if category is None:
                    category = (
                        ADMIN
                        if is_admin_command(
                            name, extra=conf["admin_extra"], exclude=conf["admin_exclude"]
                        )
                        else cog_category
                    )
                buckets.setdefault(category, []).append((name, short_doc(command.short_doc)))

        prefix = ctx.clean_prefix
        return {
            category: [f"`{prefix}{name}` — {doc}" for name, doc in sorted(rows)]
            for category, rows in buckets.items()
            if rows
        }

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    @commands.group(name="helpmenu")
    @checks.is_owner()
    async def helpmenu(self, ctx: commands.Context):
        """Configure the button help panel."""
        if ctx.invoked_subcommand is not None:
            return
        conf = await self.config.all()
        overrides = conf["overrides"]
        lines = [
            "📖 **Help panel**",
            "**Enabled:** " + ("yes" if conf["enabled"] else "no — Red's own menu is used"),
            f"**Button timeout:** {conf['timeout']}s",
            f"**Cog overrides:** {len(overrides)}",
            f"**Command overrides:** {len(conf['command_overrides'])}",
        ]
        if overrides:
            lines += [f"-# {cog} → {category}" for cog, category in sorted(overrides.items())]
        if conf["command_overrides"]:
            lines += [
                f"-# `{name}` → {category}"
                for name, category in sorted(conf["command_overrides"].items())
            ]
        lines.append("")
        lines.append(
            f"Categories: "
            + ", ".join(f"{emoji_for(n)} {n}" for n, _e, _c in DEFAULT_CATEGORIES)
            + f", 📦 {OTHER}"
        )
        await ctx.send("\n".join(lines))

    @helpmenu.command(name="on")
    async def helpmenu_on(self, ctx: commands.Context):
        """Use the button panel for `[p]help`."""
        await self.config.enabled.set(True)
        await ctx.send("✅ `help` now opens the button panel.")

    @helpmenu.command(name="off")
    async def helpmenu_off(self, ctx: commands.Context):
        """Fall back to Red's own help menu (the cog stays loaded)."""
        await self.config.enabled.set(False)
        await ctx.send("✅ `help` uses Red's own menu again.")

    @helpmenu.command(name="timeout")
    async def helpmenu_timeout(self, ctx: commands.Context, seconds: int):
        """How long the buttons stay clickable (30–900 s)."""
        if not 30 <= seconds <= 900:
            await ctx.send("🚫 Pick between **30** and **900** seconds.")
            return
        await self.config.timeout.set(seconds)
        await ctx.send(f"✅ Panels stay clickable for **{seconds}s**.")

    @helpmenu.command(name="setcategory", aliases=["move"])
    async def helpmenu_setcategory(self, ctx: commands.Context, cog: str, *, category: str):
        """Put a cog in a category, e.g. `[p]helpmenu setcategory Audio Media`.

        Any category name works — a new one gets its own button.
        """
        known = {name.lower(): name for name, _e, _c in DEFAULT_CATEGORIES}
        known[OTHER.lower()] = OTHER
        resolved = known.get(category.strip().lower(), category.strip())
        if not resolved:
            await ctx.send("🚫 Give a category name.")
            return
        loaded = {name.lower(): name for name in self.bot.cogs}
        if cog.lower() not in loaded:
            await ctx.send(
                f"⚠️ No cog named `{cog}` is loaded — storing it anyway, it will "
                f"apply once that cog is loaded."
            )
        async with self.config.overrides() as overrides:
            overrides[cog.lower()] = resolved
        await ctx.send(f"✅ `{loaded.get(cog.lower(), cog)}` now shows under **{resolved}**.")

    @helpmenu.command(name="clearcategory")
    async def helpmenu_clearcategory(self, ctx: commands.Context, cog: str):
        """Drop a category override and go back to the default placement."""
        async with self.config.overrides() as overrides:
            existed = overrides.pop(cog.lower(), None)
        await ctx.send(
            f"✅ `{cog}` is back on its default category."
            if existed
            else f"ℹ️ `{cog}` had no override."
        )

    @helpmenu.command(name="setcommand")
    async def helpmenu_setcommand(self, ctx: commands.Context, command: str, *, category: str):
        """Put one command in a category, e.g. `[p]helpmenu setcommand kills Games`.

        Beats both the naming rule and the command's cog.
        """
        target = self.bot.get_command(command)
        if target is None:
            await ctx.send(f"🚫 No command named `{command}`.")
            return
        known = {name.lower(): name for name, _e, _c in DEFAULT_CATEGORIES}
        known[OTHER.lower()] = OTHER
        resolved = known.get(category.strip().lower(), category.strip())
        async with self.config.command_overrides() as overrides:
            overrides[target.qualified_name.lower()] = resolved
        await ctx.send(f"✅ `{target.qualified_name}` now shows under **{resolved}**.")

    @helpmenu.command(name="clearcommand")
    async def helpmenu_clearcommand(self, ctx: commands.Context, command: str):
        """Drop a per-command override."""
        async with self.config.command_overrides() as overrides:
            existed = overrides.pop(command.lower(), None)
        await ctx.send(
            f"✅ `{command}` follows the normal rules again."
            if existed
            else f"ℹ️ `{command}` had no override."
        )

    @helpmenu.command(name="admincommands", aliases=["admin"])
    async def helpmenu_admincommands(self, ctx: commands.Context):
        """Which commands the Admin category currently claims."""
        conf = await self.config.all()
        claimed = sorted(
            command.qualified_name
            for command in self.bot.commands
            if is_admin_command(
                command.qualified_name,
                extra=conf["admin_extra"],
                exclude=conf["admin_exclude"],
            )
        )
        moved = sorted(
            name for name, cat in conf["command_overrides"].items() if cat == ADMIN
        )
        lines = [f"🔧 **Admin** claims **{len(claimed)}** command(s) by the naming rule:"]
        lines.append(", ".join(f"`{name}`" for name in claimed) or "—")
        if moved:
            lines.append(f"\nPlus **{len(moved)}** moved by hand: " + ", ".join(f"`{n}`" for n in moved))
        if conf["admin_exclude"]:
            lines.append("Excluded: " + ", ".join(f"`{n}`" for n in conf["admin_exclude"]))
        lines.append(
            f"\nAdd one with `{ctx.clean_prefix}helpmenu adminadd <command>`, remove with "
            f"`{ctx.clean_prefix}helpmenu adminremove <command>`."
        )
        await ctx.send("\n".join(lines))

    @helpmenu.command(name="adminadd")
    async def helpmenu_adminadd(self, ctx: commands.Context, command: str):
        """Treat a command as configuration even though its name says otherwise."""
        target = self.bot.get_command(command)
        if target is None:
            await ctx.send(f"🚫 No command named `{command}`.")
            return
        name = target.qualified_name.lower()
        async with self.config.admin_exclude() as excluded:
            if name in excluded:
                excluded.remove(name)
        async with self.config.admin_extra() as extra:
            if name not in extra:
                extra.append(name)
        await ctx.send(f"✅ `{target.qualified_name}` now sits under **{ADMIN}**.")

    @helpmenu.command(name="adminremove")
    async def helpmenu_adminremove(self, ctx: commands.Context, command: str):
        """Stop treating a command as configuration — it returns to its cog's category."""
        name = command.lower()
        async with self.config.admin_extra() as extra:
            if name in extra:
                extra.remove(name)
        async with self.config.admin_exclude() as excluded:
            if name not in excluded:
                excluded.append(name)
        await ctx.send(f"✅ `{command}` is back under its own category.")

    @helpmenu.command(name="uncategorised", aliases=["uncategorized", "other"])
    async def helpmenu_uncategorised(self, ctx: commands.Context):
        """Which loaded cogs currently land in "Other"."""
        lookup = build_lookup(DEFAULT_CATEGORIES, await self.config.overrides())
        stray = sorted(name for name in self.bot.cogs if category_of(name, lookup) == OTHER)
        if not stray:
            await ctx.send("✅ Every loaded cog has a category.")
            return
        await ctx.send(
            f"📦 **{len(stray)}** cog(s) in *Other*:\n"
            + ", ".join(f"`{name}`" for name in stray)
            + f"\n\nMove one with `{ctx.clean_prefix}helpmenu setcategory <cog> <category>`."
        )
