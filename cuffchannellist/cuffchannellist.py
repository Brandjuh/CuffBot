"""CuffChannelList — a self-updating directory of every channel.

Port of the CuffBot Node module ``src/modules/channellist`` (itself a port of
the FRA bot's cog). Posts one or more embeds listing every category and
channel with its topic, and keeps them current as channels are created,
renamed, moved or deleted.

Two things worth knowing:

* **Visibility is judged for a role**, ``@everyone`` by default. The list shows
  what that role can actually see, so a staff-only channel does not leak into
  a public directory.
* **The list edits itself in place** whenever it can. A repost only happens
  when the render needs more messages than are posted, or when one of them was
  deleted — otherwise the directory would climb the channel every ten seconds.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import discord
from redbot.core import Config, checks, commands
from redbot.core.bot import Red

from .listing import (
    ACTION_EDIT,
    ACTION_REPOST,
    ACTION_SKIP,
    AUTO_UPDATE_DELAY_S,
    DEFAULT_EMBED_COLOR,
    DEFAULT_HEADER,
    EMPTY_LIST_PLACEHOLDER,
    MAX_HEADER_LENGTH,
    chunk_blocks,
    decide_action,
    group_by_category,
    normalize_emoji_input,
    parse_hex_color,
    render_blocks,
)

log = logging.getLogger("red.cuff-cogs.cuffchannellist")

LIVE_NODE_JSON = "/home/brand/CuffBot/data/411157175948541954.json"

SUCCESS_COLOR = 0x57F287
ERROR_COLOR = 0xED4245
INFO_COLOR = 0x5865F2

TEXTLIKE = (
    discord.ChannelType.text,
    discord.ChannelType.news,
    discord.ChannelType.forum,
)
VOICELIKE = (discord.ChannelType.voice, discord.ChannelType.stage_voice)


class CuffChannelList(commands.Cog):
    """A self-updating list of every category and channel in the server."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175018, force_registration=True)
        #: No default channel: unlike the log channels, nobody named one, so
        #: the list stays unposted until an admin runs `channellist post`.
        self.config.register_guild(
            channel_id=None,
            message_ids=[],
            message_channel_id=None,
            role_id=None,  # visibility role; None = @everyone
            header=DEFAULT_HEADER,
            emoji="",
            embed_color=DEFAULT_EMBED_COLOR,
            include_voice=True,
            auto_update=True,
            ignored_ids=[],
        )
        self._locks: Dict[int, asyncio.Lock] = {}
        self._pending: Dict[int, asyncio.Task] = {}

    def cog_unload(self):
        for task in self._pending.values():
            task.cancel()

    async def red_delete_data_for_user(self, **kwargs):
        """Nothing to delete — this cog stores channel structure, not people."""
        return

    def _lock(self, guild_id: int) -> asyncio.Lock:
        if guild_id not in self._locks:
            self._locks[guild_id] = asyncio.Lock()
        return self._locks[guild_id]

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------

    def collect_descriptors(
        self, guild: discord.Guild, role_id: Optional[int]
    ) -> List[Dict[str, Any]]:
        """Flatten the guild's channels into plain dicts for the pure logic."""
        role = (guild.get_role(int(role_id)) if role_id else None) or guild.default_role
        descriptors: List[Dict[str, Any]] = []
        for channel in guild.channels:
            if channel.type is discord.ChannelType.category:
                descriptors.append(
                    {
                        "id": channel.id,
                        "kind": "category",
                        "name": channel.name,
                        "parent_id": None,
                        "position": channel.position,
                        "topic": None,
                        "visible": True,
                        "mention": f"<#{channel.id}>",
                    }
                )
                continue
            if channel.type in TEXTLIKE:
                kind = "text"
            elif channel.type in VOICELIKE:
                kind = "voice"
            else:
                continue  # threads and anything else not worth listing
            try:
                visible = channel.permissions_for(role).view_channel
            except Exception:
                visible = False
            descriptors.append(
                {
                    "id": channel.id,
                    "kind": kind,
                    "name": channel.name,
                    "parent_id": channel.category_id,
                    "position": channel.position,
                    "topic": getattr(channel, "topic", None),
                    "visible": visible,
                    "mention": f"<#{channel.id}>",
                }
            )
        return descriptors

    async def render_chunks(self, guild: discord.Guild) -> List[str]:
        conf = await self.config.guild(guild).all()
        grouped = group_by_category(
            self.collect_descriptors(guild, conf["role_id"]),
            include_voice=conf["include_voice"],
            ignored_ids=conf["ignored_ids"],
        )
        chunks = chunk_blocks(conf["header"], render_blocks(grouped, conf["emoji"] or None))
        return chunks or [f"{conf['header']}\n\n{EMPTY_LIST_PLACEHOLDER}".strip()]

    # ------------------------------------------------------------------
    # Posting
    # ------------------------------------------------------------------

    async def refresh(self, guild: discord.Guild, *, force_repost: bool = False) -> str:
        """Apply the current render. Returns a status code for the caller."""
        async with self._lock(guild.id):
            group = self.config.guild(guild)
            conf = await group.all()
            if not conf["channel_id"]:
                return "unconfigured"
            channel = guild.get_channel(int(conf["channel_id"]))
            if not isinstance(channel, (discord.TextChannel, discord.Thread)):
                return "missing-channel"
            perms = channel.permissions_for(guild.me)
            if not (perms.send_messages and perms.embed_links):
                return "missing-perms"

            chunks = await self.render_chunks(guild)
            color = discord.Color(int(conf["embed_color"]))

            # Read back what is posted. Any gap means we cannot edit in place.
            existing: Optional[List[str]] = None
            existing_messages: List[discord.Message] = []
            if not force_repost and conf["message_channel_id"] == channel.id and conf["message_ids"]:
                contents: List[str] = []
                for message_id in conf["message_ids"]:
                    try:
                        message = await channel.fetch_message(int(message_id))
                    except (discord.NotFound, discord.Forbidden, discord.HTTPException):
                        contents = []
                        existing_messages = []
                        break
                    existing_messages.append(message)
                    contents.append(message.embeds[0].description if message.embeds else "")
                existing = contents or None

            action = ACTION_REPOST if force_repost else decide_action(chunks, existing)
            if action == ACTION_SKIP:
                return "skipped"

            if action == ACTION_EDIT:
                for index, chunk in enumerate(chunks):
                    embed = discord.Embed(color=color, description=chunk[:4096])
                    await existing_messages[index].edit(embed=embed)
                # The list shrank: drop the now-surplus messages.
                for message in existing_messages[len(chunks) :]:
                    try:
                        await message.delete()
                    except (discord.NotFound, discord.Forbidden, discord.HTTPException):
                        pass
                await group.message_ids.set([m.id for m in existing_messages[: len(chunks)]])
                return "edited"

            # Repost: clear whatever we tracked before, wherever it was.
            await self._delete_tracked(guild, conf)
            new_ids = []
            for chunk in chunks:
                embed = discord.Embed(color=color, description=chunk[:4096])
                sent = await channel.send(embed=embed)
                new_ids.append(sent.id)
            await group.message_channel_id.set(channel.id)
            await group.message_ids.set(new_ids)
            return "posted"

    async def _delete_tracked(self, guild: discord.Guild, conf: Dict[str, Any]) -> int:
        """Best-effort removal of the messages we posted last time."""
        removed = 0
        if not conf.get("message_channel_id") or not conf.get("message_ids"):
            return 0
        channel = guild.get_channel(int(conf["message_channel_id"]))
        if not isinstance(channel, (discord.TextChannel, discord.Thread)):
            return 0
        for message_id in conf["message_ids"]:
            try:
                await (await channel.fetch_message(int(message_id))).delete()
                removed += 1
            except (discord.NotFound, discord.Forbidden, discord.HTTPException):
                pass
        return removed

    def schedule_update(self, guild: discord.Guild, delay: float = AUTO_UPDATE_DELAY_S) -> None:
        existing = self._pending.pop(guild.id, None)
        if existing:
            existing.cancel()

        async def later():
            try:
                await asyncio.sleep(delay)
                conf = await self.config.guild(guild).all()
                if conf["auto_update"] and conf["message_ids"]:
                    await self.refresh(guild)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning("Channel list: auto update failed for %s", guild.id, exc_info=True)
            finally:
                self._pending.pop(guild.id, None)

        self._pending[guild.id] = asyncio.create_task(later())

    # ------------------------------------------------------------------
    # Listeners
    # ------------------------------------------------------------------

    @commands.Cog.listener()
    async def on_guild_channel_create(self, channel):
        if getattr(channel, "guild", None):
            self.schedule_update(channel.guild)

    @commands.Cog.listener()
    async def on_guild_channel_delete(self, channel):
        if getattr(channel, "guild", None):
            self.schedule_update(channel.guild)

    @commands.Cog.listener()
    async def on_guild_channel_update(self, before, after):
        if getattr(after, "guild", None):
            self.schedule_update(after.guild)

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    def embed(self, title: str, description: str = "", color: int = INFO_COLOR) -> discord.Embed:
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
    @commands.group(name="channellist", aliases=["clist"], invoke_without_command=True)
    async def channellist(self, ctx: commands.Context):
        """The self-updating channel directory."""
        conf = await self.config.guild(ctx.guild).all()
        chunks = await self.render_chunks(ctx.guild)
        embed = self.embed(
            "🗂️ Channel list",
            "A self-updating directory of every category and channel, with topics.",
        )
        embed.add_field(
            name="Posted in",
            value=(
                f"<#{conf['message_channel_id']}> ({len(conf['message_ids'])} message(s))"
                if conf["message_ids"]
                else "not posted yet"
            ),
            inline=True,
        )
        embed.add_field(
            name="Target channel",
            value=f"<#{conf['channel_id']}>" if conf["channel_id"] else "⚠️ not set",
            inline=True,
        )
        embed.add_field(
            name="Auto-update", value="🟢 on" if conf["auto_update"] else "🔴 off", inline=True
        )
        embed.add_field(
            name="Visible as",
            value=f"<@&{conf['role_id']}>" if conf["role_id"] else "@everyone",
            inline=True,
        )
        embed.add_field(
            name="Voice channels", value="shown" if conf["include_voice"] else "hidden", inline=True
        )
        embed.add_field(
            name="Colour", value=f"`#{int(conf['embed_color']):06x}`", inline=True
        )
        embed.add_field(
            name="Header", value=f"```\n{(conf['header'] or '(none)')[:900]}\n```", inline=False
        )
        if conf["ignored_ids"]:
            embed.add_field(
                name=f"Ignored ({len(conf['ignored_ids'])})",
                value=" ".join(f"<#{i}>" for i in conf["ignored_ids"])[:1024],
                inline=False,
            )
        embed.set_footer(
            text=f"Current render: {len(chunks)} message(s) · "
            f"{ctx.clean_prefix}channellist post to publish"
        )
        await ctx.send(embed=embed)

    @channellist.command(name="post")
    async def channellist_post(
        self, ctx: commands.Context, channel: Optional[discord.TextChannel] = None
    ):
        """Post the list (optionally naming the channel), replacing any old copy."""
        if channel is not None:
            await self.config.guild(ctx.guild).channel_id.set(channel.id)
        async with ctx.typing():
            result = await self.refresh(ctx.guild, force_repost=True)
        await self._report(ctx, result)

    @channellist.command(name="update", aliases=["refresh"])
    async def channellist_update(self, ctx: commands.Context):
        """Refresh the posted list in place."""
        async with ctx.typing():
            result = await self.refresh(ctx.guild)
        await self._report(ctx, result)

    async def _report(self, ctx: commands.Context, result: str):
        messages = {
            "unconfigured": (
                "⚠️ No channel",
                f"Name one: `{ctx.clean_prefix}channellist post #channel`.",
            ),
            "missing-channel": ("⚠️ Channel gone", "The configured channel no longer exists."),
            "missing-perms": (
                "⚠️ Missing permissions",
                "I need **Send Messages** and **Embed Links** in that channel.",
            ),
        }
        if result in messages:
            title, description = messages[result]
            return await self.nope(ctx, description, title=title)
        conf = await self.config.guild(ctx.guild).all()
        wording = {
            "posted": "posted",
            "edited": "updated in place",
            "skipped": "already up to date",
        }[result]
        await self.ok(
            ctx,
            f"The channel list is **{wording}** in <#{conf['channel_id']}> "
            f"({len(conf['message_ids'])} message(s)).",
            title="✅ Channel list " + wording.split()[0],
        )

    @channellist.command(name="remove", aliases=["delete", "unpost"])
    async def channellist_remove(self, ctx: commands.Context):
        """Delete the posted list and stop tracking it."""
        group = self.config.guild(ctx.guild)
        conf = await group.all()
        removed = await self._delete_tracked(ctx.guild, conf)
        await group.message_ids.set([])
        await group.message_channel_id.set(None)
        await ctx.send(
            embed=self.embed(
                "🗑️ List removed" if removed else "ℹ️ Nothing posted",
                f"Deleted **{removed}** message(s)." if removed else "There was no list to delete.",
                SUCCESS_COLOR if removed else INFO_COLOR,
            )
        )

    @channellist.command(name="header")
    async def channellist_header(self, ctx: commands.Context, *, text: Optional[str] = None):
        """Text above the list. `default` restores it, `none` clears it."""
        group = self.config.guild(ctx.guild)
        if text is None:
            current = await group.header()
            return await ctx.send(
                embed=self.embed("🗂️ Current header", f"```\n{(current or '(none)')[:1900]}\n```")
            )
        lowered = text.strip().lower()
        value = "" if lowered == "none" else (DEFAULT_HEADER if lowered == "default" else text.strip())
        if len(value) > MAX_HEADER_LENGTH:
            return await self.nope(
                ctx, f"The header must stay under **{MAX_HEADER_LENGTH}** characters.",
                title="🚫 Too long",
            )
        await group.header.set(value)
        self.schedule_update(ctx.guild, delay=2)
        await self.ok(ctx, f"```\n{value or '(none)'}\n```", title="✅ Header set")

    @channellist.command(name="emoji")
    async def channellist_emoji(self, ctx: commands.Context, emoji: str):
        """Emoji framing each category header. `none` removes it."""
        value = normalize_emoji_input(emoji)
        await self.config.guild(ctx.guild).emoji.set(value)
        self.schedule_update(ctx.guild, delay=2)
        await self.ok(
            ctx,
            f"Category headers read `[{value}] [Name] [{value}]`." if value
            else "Category headers carry no emoji.",
            title="✅ Emoji set",
        )

    @channellist.command(name="color", aliases=["colour"])
    async def channellist_color(self, ctx: commands.Context, hex_color: str):
        """Embed colour, e.g. `#5865f2`."""
        value = parse_hex_color(hex_color)
        if value is None:
            return await self.nope(ctx, "That is not a hex colour. Try `#5865f2`.",
                                   title="🚫 Bad colour")
        await self.config.guild(ctx.guild).embed_color.set(value)
        self.schedule_update(ctx.guild, delay=2)
        await ctx.send(
            embed=discord.Embed(
                color=discord.Color(value),
                title="✅ Colour set",
                description=f"The list renders in `#{value:06x}`.",
            )
        )

    @channellist.command(name="role")
    async def channellist_role(self, ctx: commands.Context, role: discord.Role):
        """Show the list as this role sees it (which channels it can view)."""
        await self.config.guild(ctx.guild).role_id.set(role.id)
        self.schedule_update(ctx.guild, delay=2)
        await self.ok(
            ctx, f"The list shows the channels **{role.name}** can see.", title="✅ Role set"
        )

    @channellist.command(name="everyone")
    async def channellist_everyone(self, ctx: commands.Context):
        """Go back to listing what @everyone can see."""
        await self.config.guild(ctx.guild).role_id.set(None)
        self.schedule_update(ctx.guild, delay=2)
        await self.ok(ctx, "The list shows the channels **@everyone** can see.",
                      title="✅ Role reset")

    @channellist.command(name="voice")
    async def channellist_voice(self, ctx: commands.Context, show: bool):
        """Include voice channels in the list."""
        await self.config.guild(ctx.guild).include_voice.set(show)
        self.schedule_update(ctx.guild, delay=2)
        await self.ok(
            ctx, "Voice channels are **shown**." if show else "Voice channels are **hidden**.",
            title="✅ Voice setting",
        )

    @channellist.command(name="autoupdate")
    async def channellist_autoupdate(self, ctx: commands.Context, state: bool):
        """Keep the list current automatically when channels change."""
        await self.config.guild(ctx.guild).auto_update.set(state)
        await self.ok(
            ctx,
            f"The list refreshes itself ~{AUTO_UPDATE_DELAY_S}s after a channel changes."
            if state
            else f"Auto-update is off — refresh by hand with `{ctx.clean_prefix}channellist update`.",
            title="✅ Auto-update " + ("on" if state else "off"),
        )

    @channellist.command(name="ignore")
    async def channellist_ignore(
        self, ctx: commands.Context, target: discord.abc.GuildChannel
    ):
        """Hide a channel — or a whole category — from the list."""
        async with self.config.guild(ctx.guild).ignored_ids() as ignored:
            if target.id in ignored:
                return await ctx.send(
                    embed=self.embed("ℹ️ Already ignored", f"<#{target.id}> is already hidden.")
                )
            ignored.append(target.id)
        self.schedule_update(ctx.guild, delay=2)
        extra = " and everything in it" if isinstance(target, discord.CategoryChannel) else ""
        await self.ok(ctx, f"<#{target.id}>{extra} is hidden from the list.", title="✅ Ignored")

    @channellist.command(name="unignore")
    async def channellist_unignore(
        self, ctx: commands.Context, target: discord.abc.GuildChannel
    ):
        """Show a previously ignored channel or category again."""
        async with self.config.guild(ctx.guild).ignored_ids() as ignored:
            if target.id not in ignored:
                return await ctx.send(
                    embed=self.embed("ℹ️ Not ignored", f"<#{target.id}> was not hidden.")
                )
            ignored.remove(target.id)
        self.schedule_update(ctx.guild, delay=2)
        await self.ok(ctx, f"<#{target.id}> is listed again.", title="✅ Unignored")

    @channellist.command(name="migratecuff")
    @checks.is_owner()
    async def channellist_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = LIVE_NODE_JSON
    ):
        """Migrate settings from the CuffBot Node data file."""
        mode = mode.lower()
        if mode not in ("preview", "apply"):
            return await self.nope(ctx, f"Unknown mode `{mode}`. Use `preview` or `apply`.",
                                   title="🚫 Unknown mode")
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            return await self.nope(ctx, f"Could not read `{path}`:\n```\n{error}\n```",
                                   title="🚫 Migration failed")

        node = data.get("channellistConfig")
        if not isinstance(node, dict):
            return await ctx.send(
                embed=self.embed("ℹ️ Nothing to migrate", "No `channellistConfig` in that file.")
            )

        changes: Dict[str, Any] = {}
        if node.get("channelId"):
            changes["channel_id"] = int(node["channelId"])
        if "autoUpdate" in node:
            changes["auto_update"] = bool(node["autoUpdate"])
        if "header" in node:
            changes["header"] = str(node["header"])[:MAX_HEADER_LENGTH]
        if "emoji" in node:
            changes["emoji"] = normalize_emoji_input(node["emoji"])
        if node.get("roleId"):
            changes["role_id"] = int(node["roleId"])
        if "includeVoice" in node:
            changes["include_voice"] = bool(node["includeVoice"])
        if isinstance(node.get("ignoredIds"), list):
            changes["ignored_ids"] = [int(i) for i in node["ignoredIds"]]
        if node.get("embedColor") is not None:
            changes["embed_color"] = int(node["embedColor"])

        # Deliberately NOT migrated: messageIds. Those messages belong to the
        # Node bot; editing them would need its token. `post` publishes a fresh
        # list — delete the old one by hand.
        summary = "\n".join(f"{key} = {value}" for key, value in changes.items())
        if mode == "preview":
            return await ctx.send(
                embed=self.embed(
                    "🔍 Channel-list migration preview",
                    f"Nothing written. Run with `apply` to commit.\n```\n{summary}\n```",
                )
            )
        group = self.config.guild(ctx.guild)
        for key, value in changes.items():
            await group.get_attr(key).set(value)
        await self.ok(
            ctx,
            f"Migrated from `{path}`:\n```\n{summary}\n```\n"
            f"The Node bot's own list message is not adopted — run "
            f"`{ctx.clean_prefix}channellist post` and delete the old one.",
            title="✅ Migration applied",
        )
