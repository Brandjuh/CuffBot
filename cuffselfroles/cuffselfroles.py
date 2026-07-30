"""CuffSelfRoles — a button list members use to pick their own roles.

Port of the CuffBot Node module ``src/modules/selfroles``.

The roster is **not** a stored list. It is read live from the guild's role
list: everything under a header role named ``self-roles``, stopping at the next
divider. An admin adds a self role by dragging it into that section in
Discord's own role editor, and the posted list follows within 15 seconds.

Two guarantees carried over from the Node module:

* **A role with elevated permissions is never self-assignable.** Managed roles
  and anything carrying Administrator, Manage-anything, Kick, Ban, Timeout or
  Mention-everyone is skipped and reported, not offered as a button.
* **Every button press is validated against the live role list**, not against
  whatever the message was posted with. A role that slid out of the section
  since is refused, and the stale list refreshes itself.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import discord
from redbot.core import Config, checks, commands
from redbot.core.bot import Red

from .selfroles import (
    BUTTONS_PER_MESSAGE,
    DEFAULT_HEADER_NAME,
    MAX_SELF_ROLES,
    button_label,
    chunk,
    render_lines,
    select_self_roles,
)

log = logging.getLogger("red.cuff-cogs.cuffselfroles")

LIVE_NODE_JSON = "/home/brand/CuffBot/data/411157175948541954.json"

EMBED_COLOR = 0x5865F2
SUCCESS_COLOR = 0x57F287
ERROR_COLOR = 0xED4245

#: Owner decision (Node S59): the list lives in this channel.
DEFAULT_CHANNEL_ID = 625276074833608705

BUTTON_PREFIX = "cuffselfroles:toggle:"

#: Role edits arrive in bursts (drag three roles, get three events).
REFRESH_DELAY_S = 15
#: Boot catch-up waits for the role cache to settle.
BOOT_DELAY_S = 20

#: A self-assignable role must never carry any of these.
ELEVATED_PERMISSIONS = (
    "administrator",
    "manage_guild",
    "manage_roles",
    "manage_channels",
    "manage_messages",
    "manage_webhooks",
    "moderate_members",
    "kick_members",
    "ban_members",
    "mention_everyone",
)


class CuffSelfRoles(commands.Cog):
    """A button list in the self-roles channel: press to get a role, press again to drop it."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175017, force_registration=True)
        self.config.register_guild(
            enabled=True,
            channel_id=DEFAULT_CHANNEL_ID,
            header_name=DEFAULT_HEADER_NAME,
            #: role id (str) -> {"text": ..., "emoji": ...}
            info={},
            #: Where the posted list lives, so the bot can always edit its own.
            message_channel_id=None,
            message_ids=[],
        )
        #: One refresh at a time per guild — a debounced auto-update and a
        #: manual post must never interleave and duplicate the list.
        self._locks: Dict[int, asyncio.Lock] = {}
        self._pending: Dict[int, asyncio.Task] = {}
        self._startup = asyncio.create_task(self._boot())

    async def _boot(self):
        await self.bot.wait_until_red_ready()
        await asyncio.sleep(BOOT_DELAY_S)
        for guild in self.bot.guilds:
            try:
                # Only once a list was posted: `selfroles post` is the admin's
                # explicit go-live moment, the bot posts nothing on its own.
                if await self.config.guild(guild).message_ids():
                    await self.refresh(guild)
            except Exception:
                log.warning("Self roles: boot refresh failed for %s", guild.id, exc_info=True)

    def cog_unload(self):
        if self._startup is not None:
            self._startup.cancel()
        for task in self._pending.values():
            task.cancel()

    async def red_delete_data_for_user(self, **kwargs):
        """Nothing to delete — role membership lives in Discord, not here."""
        return

    def _lock(self, guild_id: int) -> asyncio.Lock:
        if guild_id not in self._locks:
            self._locks[guild_id] = asyncio.Lock()
        return self._locks[guild_id]

    # ------------------------------------------------------------------
    # Detection
    # ------------------------------------------------------------------

    @staticmethod
    def _is_elevated(role: discord.Role) -> bool:
        return any(getattr(role.permissions, name, False) for name in ELEVATED_PERMISSIONS)

    async def detect(self, guild: discord.Guild) -> Dict[str, Any]:
        """Read the self-roles section straight off the guild's role list."""
        header_name = await self.config.guild(guild).header_name()
        roles_desc = [
            {
                "id": role.id,
                "name": role.name,
                "managed": role.managed,
                "elevated": self._is_elevated(role),
            }
            for role in sorted(guild.roles, key=lambda r: r.position, reverse=True)
        ]
        return select_self_roles(roles_desc, header_name=header_name, cap=MAX_SELF_ROLES)

    async def build_payloads(self, guild: discord.Guild) -> tuple:
        """``(detection, [(embed, view), …])`` — one entry per 25 roles."""
        detection = await self.detect(guild)
        info = await self.config.guild(guild).info()

        payloads = []
        for index, roles in enumerate(chunk(detection["roles"], BUTTONS_PER_MESSAGE)):
            lines = render_lines(roles, info)
            if index == 0:
                description = "\n".join(
                    [
                        "Pick your own roles — press a button to get the role, press it "
                        "again to take it off.",
                        "",
                        *(lines or ["_No self-assignable roles found under the header right now._"]),
                    ]
                )
                title = "🎭 Self roles"
            else:
                description = "\n".join(lines)
                title = "🎭 Self roles (continued)"

            embed = discord.Embed(color=EMBED_COLOR, title=title, description=description[:4096])
            view = discord.ui.View(timeout=None)
            for position, role in enumerate(roles):
                button = discord.ui.Button(
                    style=discord.ButtonStyle.secondary,
                    label=button_label(role["name"]),
                    custom_id=f"{BUTTON_PREFIX}{role['id']}",
                    row=position // 5,
                )
                emoji = (info.get(str(role["id"])) or {}).get("emoji")
                if emoji:
                    try:
                        button.emoji = emoji
                    except Exception:
                        pass  # invalid emoji — the label still names the role
                view.add_item(button)
            payloads.append((embed, view))
        return detection, payloads

    # ------------------------------------------------------------------
    # Posting / refreshing
    # ------------------------------------------------------------------

    async def refresh(self, guild: discord.Guild) -> str:
        """Bring the posted list in line with the live role list.

        Returns one of ``disabled``, ``unconfigured``, ``missing-channel``,
        ``no-header``, ``edited`` or ``posted``.
        """
        async with self._lock(guild.id):
            group = self.config.guild(guild)
            conf = await group.all()
            if not conf["enabled"]:
                return "disabled"
            if not conf["channel_id"]:
                return "unconfigured"
            channel = guild.get_channel(int(conf["channel_id"]))
            if not isinstance(channel, (discord.TextChannel, discord.Thread)):
                return "missing-channel"
            perms = channel.permissions_for(guild.me)
            if not (perms.send_messages and perms.embed_links):
                return "missing-channel"

            detection, payloads = await self.build_payloads(guild)
            if not detection["header_found"]:
                return "no-header"

            old_ids = list(conf["message_ids"] or [])
            same_channel = conf["message_channel_id"] == channel.id
            new_ids: List[int] = []
            posted_any = False

            for index, (embed, view) in enumerate(payloads):
                existing = old_ids[index] if same_channel and index < len(old_ids) else None
                if existing:
                    try:
                        message = await channel.fetch_message(int(existing))
                        await message.edit(embed=embed, view=view)
                        new_ids.append(int(existing))
                        continue
                    except (discord.NotFound, discord.Forbidden, discord.HTTPException):
                        pass  # gone or unreachable — post a fresh one below
                sent = await channel.send(embed=embed, view=view)
                new_ids.append(sent.id)
                posted_any = True

            # The roster shrank, or the list moved channels: clean up the
            # copies we are no longer tracking. Best-effort by design.
            leftovers = old_ids[len(payloads) :] if same_channel else old_ids
            cleanup_channel = channel if same_channel else guild.get_channel(
                int(conf["message_channel_id"]) if conf["message_channel_id"] else 0
            )
            if isinstance(cleanup_channel, (discord.TextChannel, discord.Thread)):
                for message_id in leftovers:
                    try:
                        await (await cleanup_channel.fetch_message(int(message_id))).delete()
                    except (discord.NotFound, discord.Forbidden, discord.HTTPException):
                        pass

            await group.message_channel_id.set(channel.id)
            await group.message_ids.set(new_ids)
            return "posted" if posted_any else "edited"

    def schedule_refresh(self, guild: discord.Guild, delay: float = REFRESH_DELAY_S) -> None:
        """Debounced refresh — a burst of role edits becomes one update."""
        existing = self._pending.pop(guild.id, None)
        if existing:
            existing.cancel()

        async def later():
            try:
                await asyncio.sleep(delay)
                if await self.config.guild(guild).message_ids():
                    await self.refresh(guild)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning("Self roles: auto refresh failed for %s", guild.id, exc_info=True)
            finally:
                self._pending.pop(guild.id, None)

        self._pending[guild.id] = asyncio.create_task(later())

    # ------------------------------------------------------------------
    # Listeners
    # ------------------------------------------------------------------

    @commands.Cog.listener()
    async def on_guild_role_create(self, role: discord.Role):
        self.schedule_refresh(role.guild)

    @commands.Cog.listener()
    async def on_guild_role_delete(self, role: discord.Role):
        self.schedule_refresh(role.guild)

    @commands.Cog.listener()
    async def on_guild_role_update(self, before: discord.Role, after: discord.Role):
        self.schedule_refresh(after.guild)

    @commands.Cog.listener()
    async def on_interaction(self, interaction: discord.Interaction):
        """The button pump.

        A plain listener rather than a registered persistent view: the buttons
        are built from live role ids, so there is no fixed set to register, and
        this keeps working across restarts without re-adding views.
        """
        if interaction.type is not discord.InteractionType.component:
            return
        custom_id = (interaction.data or {}).get("custom_id", "")
        if not custom_id.startswith(BUTTON_PREFIX):
            return
        try:
            guild, member = interaction.guild, interaction.user
            if guild is None or not isinstance(member, discord.Member):
                return
            role_id = int(custom_id[len(BUTTON_PREFIX) :])
            message = await self.toggle(guild, member, role_id)
            await interaction.response.send_message(message, ephemeral=True)
        except Exception:
            log.warning("Self roles: button press failed", exc_info=True)
            try:
                await interaction.response.send_message(
                    "⚠️ Something went wrong on my end — try again in a moment.", ephemeral=True
                )
            except discord.HTTPException:
                pass

    async def toggle(self, guild: discord.Guild, member: discord.Member, role_id: int) -> str:
        """Toggle one self role, validated against the LIVE role list."""
        detection = await self.detect(guild)
        match = next((r for r in detection["roles"] if int(r["id"]) == role_id), None)
        if match is None:
            self.schedule_refresh(guild, delay=1)
            return "⚠️ That role is not self-assignable (anymore) — the list is refreshing itself."
        role = guild.get_role(role_id)
        if role is None:
            self.schedule_refresh(guild, delay=1)
            return "⚠️ That role no longer exists — the list is refreshing itself."
        try:
            if role in member.roles:
                await member.remove_roles(role, reason="Self role removed by the member — via CuffBot")
                return f"🗑️ **{role.name}** removed."
            await member.add_roles(role, reason="Self role picked by the member — via CuffBot")
            return f"✅ You now have **{role.name}**. Press the button again to take it off."
        except discord.HTTPException as error:
            log.warning("Self roles: toggle of %s for %s failed: %s", role_id, member.id, error)
            return (
                f"⚠️ Could not toggle **{role.name}** — my role probably sits below it. "
                "An admin can check the role order."
            )

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    def embed(self, title: str, description: str = "", color: int = EMBED_COLOR) -> discord.Embed:
        return discord.Embed(color=color, title=title, description=description)

    async def ok(self, ctx, description: str, *, title: str = "✅ Done"):
        await ctx.send(
            embed=self.embed(title, description, SUCCESS_COLOR),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    async def nope(self, ctx, description: str, *, title: str = "🚫 No"):
        await ctx.send(
            embed=self.embed(title, description, ERROR_COLOR),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @commands.guild_only()
    @checks.admin_or_permissions(manage_guild=True)
    # NOT aliased to "selfrole": Red's core admin cog already owns that name
    # (its own, unrelated opt-in role list), and a clashing alias stops this
    # whole cog from loading.
    @commands.group(name="selfroles", aliases=["rolepanel", "roleboard"], invoke_without_command=True)
    async def selfroles(self, ctx: commands.Context):
        """The self-roles button list: post it, refresh it, set per-role info."""
        conf = await self.config.guild(ctx.guild).all()
        detection = await self.detect(ctx.guild)

        embed = self.embed(
            "🎭 Self roles",
            "The roster is read live from the role list: every role **under** the "
            f"`{conf['header_name']}` header role, up to the next divider. Drag a role "
            "into that section and the posted list follows within 15 seconds.",
        )
        embed.add_field(name="Enabled", value="🟢 yes" if conf["enabled"] else "🔴 no", inline=True)
        embed.add_field(
            name="Channel",
            value=f"<#{conf['channel_id']}>" if conf["channel_id"] else "⚠️ not set",
            inline=True,
        )
        embed.add_field(
            name="Posted",
            value=f"**{len(conf['message_ids'])}** message(s)" if conf["message_ids"] else "not yet",
            inline=True,
        )
        if not detection["header_found"]:
            embed.add_field(
                name="⚠️ No header role",
                value=(
                    f"No role called **{conf['header_name']}** exists. Create one (it needs no "
                    "permissions) and put the self-assignable roles below it."
                ),
                inline=False,
            )
        else:
            names = ", ".join(f"**{r['name']}**" for r in detection["roles"]) or "_none_"
            embed.add_field(
                name=f"Detected ({len(detection['roles'])})", value=names[:1024], inline=False
            )
        if detection["skipped"]:
            embed.add_field(
                name="Skipped",
                value="\n".join(
                    f"**{s['name']}** — {s['reason']}" for s in detection["skipped"][:10]
                )[:1024],
                inline=False,
            )
        embed.add_field(
            name="Commands",
            value=(
                f"`{ctx.clean_prefix}selfroles post` — post or refresh the list\n"
                f"`{ctx.clean_prefix}selfroles channel #chan`\n"
                f"`{ctx.clean_prefix}selfroles info <role> <text>`\n"
                f"`{ctx.clean_prefix}selfroles emoji <role> <emoji>`\n"
                f"`{ctx.clean_prefix}selfroles clearinfo <role>`\n"
                f"`{ctx.clean_prefix}selfroles header <name>` · `on` / `off`"
            ),
            inline=False,
        )
        await ctx.send(embed=embed)

    @selfroles.command(name="on")
    async def selfroles_on(self, ctx: commands.Context):
        """Turn self-roles on."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await self.ok(ctx, "Self roles are **on**.", title="🟢 Self roles on")

    @selfroles.command(name="off")
    async def selfroles_off(self, ctx: commands.Context):
        """Turn self-roles off. The posted list stays where it is."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.send(
            embed=self.embed(
                "📴 Self roles off",
                "The list is no longer refreshed. Existing buttons keep working until you "
                "delete the message — turn it back on to resume updates.",
            )
        )

    @selfroles.command(name="channel")
    async def selfroles_channel(self, ctx: commands.Context, channel: discord.TextChannel):
        """Set the channel where the button list lives."""
        await self.config.guild(ctx.guild).channel_id.set(channel.id)
        note = ""
        perms = channel.permissions_for(ctx.guild.me)
        if not (perms.send_messages and perms.embed_links):
            note = "\n\n⚠️ I need **Send Messages** and **Embed Links** there."
        await self.ok(
            ctx,
            f"The self-roles list lives in {channel.mention}. Run "
            f"`{ctx.clean_prefix}selfroles post` to move it.{note}",
            title="✅ Channel set",
        )

    @selfroles.command(name="header")
    async def selfroles_header(self, ctx: commands.Context, *, name: str):
        """Name of the header role the section starts at."""
        await self.config.guild(ctx.guild).header_name.set(name.strip())
        detection = await self.detect(ctx.guild)
        found = (
            f"Found **{len(detection['roles'])}** role(s) under it."
            if detection["header_found"]
            else "⚠️ No role by that name exists yet."
        )
        await self.ok(ctx, f"The section starts at **{name.strip()}**. {found}",
                      title="✅ Header set")

    @selfroles.command(name="post", aliases=["refresh", "update"])
    async def selfroles_post(self, ctx: commands.Context):
        """Post the list now, or refresh the existing one."""
        async with ctx.typing():
            result = await self.refresh(ctx.guild)
        messages = {
            "disabled": ("📴 Self roles are off", f"Turn them on with `{ctx.clean_prefix}selfroles on`."),
            "unconfigured": ("⚠️ No channel", f"Set one with `{ctx.clean_prefix}selfroles channel #chan`."),
            "missing-channel": (
                "⚠️ Channel unusable",
                "The configured channel is gone, or I cannot send embeds there.",
            ),
            "no-header": (
                "⚠️ No header role",
                "Create a role with the header name and put the self-assignable roles below it.",
            ),
        }
        if result in messages:
            title, description = messages[result]
            return await self.nope(ctx, description, title=title)
        conf = await self.config.guild(ctx.guild).all()
        await self.ok(
            ctx,
            f"The list is {'posted' if result == 'posted' else 'up to date'} in "
            f"<#{conf['channel_id']}> across **{len(conf['message_ids'])}** message(s).",
            title="✅ List " + ("posted" if result == "posted" else "refreshed"),
        )

    @selfroles.command(name="info")
    async def selfroles_info(self, ctx: commands.Context, role: discord.Role, *, text: str):
        """Set the info text shown next to a role in the list."""
        async with self.config.guild(ctx.guild).info() as info:
            entry = dict(info.get(str(role.id)) or {})
            entry["text"] = text.strip()[:200]
            info[str(role.id)] = entry
        self.schedule_refresh(ctx.guild, delay=2)
        await self.ok(ctx, f"**{role.name}** — {text.strip()[:200]}", title="✅ Info set")

    @selfroles.command(name="emoji")
    async def selfroles_emoji(self, ctx: commands.Context, role: discord.Role, emoji: str):
        """Set the emoji shown on a role's line and button."""
        async with self.config.guild(ctx.guild).info() as info:
            entry = dict(info.get(str(role.id)) or {})
            entry["emoji"] = emoji.strip()[:80]
            info[str(role.id)] = entry
        self.schedule_refresh(ctx.guild, delay=2)
        await self.ok(ctx, f"{emoji.strip()[:80]} **{role.name}**", title="✅ Emoji set")

    @selfroles.command(name="clearinfo")
    async def selfroles_clearinfo(self, ctx: commands.Context, role: discord.Role):
        """Remove the stored info text and emoji for a role."""
        async with self.config.guild(ctx.guild).info() as info:
            existed = info.pop(str(role.id), None) is not None
        if existed:
            self.schedule_refresh(ctx.guild, delay=2)
        await ctx.send(
            embed=self.embed(
                "🗑️ Info cleared" if existed else "ℹ️ Nothing stored",
                f"**{role.name}** has no info text or emoji"
                + (" any more." if existed else " to clear."),
                SUCCESS_COLOR if existed else EMBED_COLOR,
            )
        )

    @selfroles.command(name="migratecuff")
    @checks.is_owner()
    async def selfroles_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = LIVE_NODE_JSON
    ):
        """Migrate settings and per-role info from the CuffBot Node data file."""
        mode = mode.lower()
        if mode not in ("preview", "apply"):
            return await self.nope(ctx, f"Unknown mode `{mode}`. Use `preview` or `apply`.",
                                   title="🚫 Unknown mode")
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            return await self.nope(ctx, f"Could not read `{path}`:\n```\n{error}\n```",
                                   title="🚫 Migration failed")

        changes: Dict[str, Any] = {}
        node_config = data.get("selfrolesConfig")
        if isinstance(node_config, dict):
            if "enabled" in node_config:
                changes["enabled"] = bool(node_config["enabled"])
            if node_config.get("channelId"):
                changes["channel_id"] = int(node_config["channelId"])
            if node_config.get("headerName"):
                changes["header_name"] = str(node_config["headerName"])

        node_info = data.get("selfrolesInfo")
        if isinstance(node_info, dict) and node_info:
            changes["info"] = {
                str(role_id): {
                    key: value
                    for key, value in (("text", entry.get("text")), ("emoji", entry.get("emoji")))
                    if value
                }
                for role_id, entry in node_info.items()
                if isinstance(entry, dict)
            }

        # Deliberately NOT migrated: the posted message ids. Those messages
        # belong to the Node bot and carry its custom_ids, so their buttons are
        # dead. `selfroles post` puts up a fresh, working list.
        if not changes:
            return await ctx.send(
                embed=self.embed("ℹ️ Nothing to migrate", "No self-roles keys in that file.")
            )

        summary = "\n".join(
            f"{key} = {value if not isinstance(value, dict) else f'<{len(value)} roles>'}"
            for key, value in changes.items()
        )
        if mode == "preview":
            return await ctx.send(
                embed=self.embed(
                    "🔍 Self-roles migration preview",
                    f"Nothing written. Run with `apply` to commit.\n```\n{summary}\n```",
                )
            )
        group = self.config.guild(ctx.guild)
        for key, value in changes.items():
            await group.get_attr(key).set(value)
        await self.ok(
            ctx,
            f"Migrated from `{path}`:\n```\n{summary}\n```\n"
            f"The Node bot's own list message is dead (its buttons point at a stopped bot) — "
            f"run `{ctx.clean_prefix}selfroles post` for a working one, then delete the old.",
            title="✅ Migration applied",
        )
