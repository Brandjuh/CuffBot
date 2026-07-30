"""CuffMemorial — the fallen-heroes tracker.

Port of the CuffBot Node module ``src/modules/memorial``. Polls the Fallen
Firefighters (firehero.org) and Fallen Officers (odmp.org) feeds every 30
minutes and honours new entries in the configured channel, tagging the
matching role.

Three rules carried over, each the result of something going wrong once:

* **A feed baselines on first sight.** The first successful fetch marks every
  current item as seen *without posting*. A fresh install must honour the
  fallen going forward, not dump years of history into a channel.
* **Unreachable is not empty.** A fetch failure returns nothing at all rather
  than an empty item list, so a timeout can never be mistaken for "the feed
  baselined with zero items" and wipe the tracker's memory.
* **firehero.org has no memorial-only feed.** Its feed carries all site news,
  so only items whose link points at a hero profile are honoured. Plain news
  is filtered out and never posted.

The role ping here is deliberate — it is the one intentional ping in the
precinct, and it exists because people asked to be told.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp
import discord
from discord.ext import tasks
from redbot.core import Config, checks, commands
from redbot.core.bot import Red

from .rss import item_matches_feed, merge_seen, parse_feed, unseen_items

log = logging.getLogger("red.cuff-cogs.cuffmemorial")

LIVE_NODE_JSON = "/home/brand/CuffBot/data/411157175948541954.json"

MEMORIAL_COLOR = 0x2C3E50
SUCCESS_COLOR = 0x57F287
ERROR_COLOR = 0xED4245

SWEEP_MINUTES = 30
FETCH_TIMEOUT_S = 20
USER_AGENT = "CuffBot memorial (Discord bot; respectful RSS polling)"

#: Owner-specified sources. The ids are the owner's own guild roles/channels,
#: committed as product config the same way the Node module had them.
FEEDS: List[Dict[str, Any]] = [
    {
        "id": "firehero",
        "title": "Fallen Firefighters",
        "emoji": "🚒",
        "url": "https://www.firehero.org/feed/",
        "role_id": 627943529544417300,
        # Hero profiles live under /fallen-firefighter/; everything else on
        # that feed is site news and must never be posted as a memorial.
        "match": {"link_includes": ["/fallen-firefighter"]},
    },
    {
        "id": "odmp",
        "title": "Fallen Officers",
        "emoji": "🚓",
        "url": "https://www.odmp.org/feed",
        "role_id": 627946543273738240,
        "match": None,
    },
]

#: Owner decision: the officers feed posts here.
DEFAULT_ODMP_CHANNEL_ID = 451095508560379934


class CuffMemorial(commands.Cog):
    """Honours new Fallen Firefighter and Fallen Officer entries."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175019, force_registration=True)
        self.config.register_guild(
            #: The live Node config had this off. Ported as-is — switching a
            #: pinging feed on is the admin's call, not the porter's.
            enabled=False,
            channel_id=None,  # shared fallback
            odmp_channel_id=DEFAULT_ODMP_CHANNEL_ID,
            firehero_channel_id=None,
            odmp_role_id=None,  # None = the FEEDS default
            firehero_role_id=None,
            #: feed id -> [seen item ids]. A feed absent here has never been
            #: baselined, which is what triggers the no-post first fetch.
            seen={},
        )
        self._session: Optional[aiohttp.ClientSession] = None
        self._sweep_lock = asyncio.Lock()
        self._startup = asyncio.create_task(self._start())

    async def _start(self):
        await self.bot.wait_until_red_ready()
        self._session = aiohttp.ClientSession(headers={"User-Agent": USER_AGENT})
        self.sweep_loop.start()

    def cog_unload(self):
        self.sweep_loop.cancel()
        if self._startup is not None:
            self._startup.cancel()
        if self._session is not None:
            asyncio.create_task(self._session.close())

    async def red_delete_data_for_user(self, **kwargs):
        """Nothing to delete — the tracker stores feed item ids, not people."""
        return

    async def session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(headers={"User-Agent": USER_AGENT})
        return self._session

    # ------------------------------------------------------------------
    # Config helpers
    # ------------------------------------------------------------------

    @staticmethod
    def channel_id_for(conf: Dict[str, Any], feed: Dict[str, Any]) -> Optional[int]:
        """A feed's own channel, else the shared fallback."""
        own = conf.get(f"{feed['id']}_channel_id")
        return int(own) if own else (int(conf["channel_id"]) if conf.get("channel_id") else None)

    @staticmethod
    def role_id_for(conf: Dict[str, Any], feed: Dict[str, Any]) -> Optional[int]:
        """A feed's ping role: the config override, else the committed default."""
        override = conf.get(f"{feed['id']}_role_id")
        return int(override) if override else (feed.get("role_id") or None)

    # ------------------------------------------------------------------
    # Fetching
    # ------------------------------------------------------------------

    async def fetch_items(self, feed: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
        """Items for one feed, or **None** on any failure.

        The None-vs-empty distinction matters: callers must be able to tell
        "reachable but nothing matches" from "unreachable", because only the
        first one is allowed to baseline the feed.
        """
        try:
            session = await self.session()
            timeout = aiohttp.ClientTimeout(total=FETCH_TIMEOUT_S)
            async with session.get(feed["url"], timeout=timeout) as response:
                if response.status != 200:
                    log.warning("Memorial: %s feed returned HTTP %s", feed["id"], response.status)
                    return None
                return parse_feed(await response.text())
        except Exception as error:
            log.warning("Memorial: %s feed unreachable (%s)", feed["id"], error)
            return None

    async def probe(self, url: str) -> Dict[str, Any]:
        """Live-check any candidate feed URL and report what it contains."""
        if not str(url or "").lower().startswith(("http://", "https://")):
            return {"ok": False, "code": "bad-url"}
        try:
            session = await self.session()
            timeout = aiohttp.ClientTimeout(total=FETCH_TIMEOUT_S)
            async with session.get(url, timeout=timeout) as response:
                if response.status != 200:
                    return {"ok": False, "code": "http", "status": response.status}
                items = parse_feed(await response.text())
        except Exception as error:
            return {"ok": False, "code": "unreachable", "message": str(error)}
        return {
            "ok": True,
            "total": len(items),
            "sample": [{"title": i["title"], "link": i["link"]} for i in items[:3]],
        }

    def memorial_embed(self, feed: Dict[str, Any], item: Dict[str, Any]) -> discord.Embed:
        embed = discord.Embed(
            color=MEMORIAL_COLOR,
            title=f"🕯️ {feed['emoji']} {item['title']}"[:256],
            description=f"{feed['title']} — gone, but not forgotten."
            + (f"\n_{item['pub_date']}_" if item.get("pub_date") else ""),
        )
        link = item.get("link") or ""
        if link.lower().startswith(("http://", "https://")):
            embed.url = link
        return embed

    # ------------------------------------------------------------------
    # The sweep
    # ------------------------------------------------------------------

    async def sweep(self, guild: discord.Guild) -> int:
        """One polling pass for a guild. Returns how many entries were posted."""
        group = self.config.guild(guild)
        conf = await group.all()
        if not conf["enabled"]:
            return 0
        if await self.bot.cog_disabled_in_guild(self, guild):
            return 0

        posted = 0
        for feed in FEEDS:
            channel_id = self.channel_id_for(conf, feed)
            if not channel_id:
                continue
            channel = guild.get_channel(channel_id)
            if not isinstance(channel, (discord.TextChannel, discord.Thread)):
                continue
            if not channel.permissions_for(guild.me).send_messages:
                continue

            items = await self.fetch_items(feed)
            if items is None:
                continue  # unreachable — retry next sweep, never baseline
            matching = [i for i in items if item_matches_feed(feed.get("match"), i)]

            seen_all = await group.seen()
            seen_ids = seen_all.get(feed["id"])
            if not isinstance(seen_ids, list):
                # Baseline: record, do not post — even with zero matching items
                # (a filtered feed may be all news today).
                async with group.seen() as seen:
                    seen[feed["id"]] = merge_seen([], [i["id"] for i in matching])
                log.info(
                    "Memorial: baselined %s with %d matching item(s) (%d total).",
                    feed["id"],
                    len(matching),
                    len(items),
                )
                continue

            ping_role_id = self.role_id_for(conf, feed)
            for item in unseen_items(matching, seen_ids):
                try:
                    await channel.send(
                        content=f"<@&{ping_role_id}>" if ping_role_id else None,
                        embed=self.memorial_embed(feed, item),
                        allowed_mentions=(
                            discord.AllowedMentions(roles=[discord.Object(id=ping_role_id)])
                            if ping_role_id
                            else discord.AllowedMentions.none()
                        ),
                    )
                except discord.HTTPException as error:
                    log.warning("Memorial: post failed for %s (%s)", feed["id"], error)
                    break  # channel is broken right now; retry the rest later
                posted += 1
                # Marked seen per successful post, so a failure retries.
                async with group.seen() as seen:
                    seen[feed["id"]] = merge_seen(seen.get(feed["id"]), [item["id"]])
        return posted

    @tasks.loop(minutes=SWEEP_MINUTES)
    async def sweep_loop(self):
        if self._sweep_lock.locked():
            return
        async with self._sweep_lock:
            for guild in list(self.bot.guilds):
                try:
                    await self.sweep(guild)
                except Exception:
                    log.warning("Memorial: sweep failed in %s", guild.id, exc_info=True)

    @sweep_loop.before_loop
    async def _before_sweep(self):
        await self.bot.wait_until_red_ready()

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    def embed(self, title: str, description: str = "", color: int = MEMORIAL_COLOR) -> discord.Embed:
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
    @commands.group(name="memorial", invoke_without_command=True)
    async def memorial(self, ctx: commands.Context):
        """The fallen-heroes tracker: feeds, channels, ping roles."""
        conf = await self.config.guild(ctx.guild).all()
        embed = self.embed(
            "🕯️ Fallen heroes",
            "New entries from the Fallen Firefighters and Fallen Officers feeds are "
            f"honoured in their channel, checked every {SWEEP_MINUTES} minutes.",
        )
        embed.add_field(
            name="Enabled", value="🟢 yes" if conf["enabled"] else "🔴 no", inline=True
        )
        embed.add_field(
            name="Shared channel",
            value=f"<#{conf['channel_id']}>" if conf["channel_id"] else "none",
            inline=True,
        )
        embed.add_field(name="Poll", value=f"every {SWEEP_MINUTES} min", inline=True)

        for feed in FEEDS:
            channel_id = self.channel_id_for(conf, feed)
            role_id = self.role_id_for(conf, feed)
            seen = (conf["seen"] or {}).get(feed["id"])
            state = (
                f"**{len(seen)}** entries known" if isinstance(seen, list) else "not baselined yet"
            )
            embed.add_field(
                name=f"{feed['emoji']} {feed['title']}",
                value=(
                    f"Channel: {f'<#{channel_id}>' if channel_id else '⚠️ none — this feed is skipped'}\n"
                    f"Ping role: {f'<@&{role_id}>' if role_id else 'none'}\n"
                    f"{state}"
                ),
                inline=False,
            )
        embed.add_field(
            name="Commands",
            value=(
                f"`{ctx.clean_prefix}memorial on` / `off`\n"
                f"`{ctx.clean_prefix}memorial channel #chan` — shared fallback\n"
                f"`{ctx.clean_prefix}memorial officerschannel #chan` · `firefighterschannel #chan`\n"
                f"`{ctx.clean_prefix}memorial officersrole @role` · `firefightersrole @role`\n"
                f"`{ctx.clean_prefix}memorial preview` — fetch now, post nothing\n"
                f"`{ctx.clean_prefix}memorial probe <url>` — try any feed URL"
            ),
            inline=False,
        )
        await ctx.send(embed=embed)

    @memorial.command(name="on")
    async def memorial_on(self, ctx: commands.Context):
        """Turn the memorial tracker on."""
        await self.config.guild(ctx.guild).enabled.set(True)
        conf = await self.config.guild(ctx.guild).all()
        unbaselined = [f["title"] for f in FEEDS if not isinstance((conf["seen"] or {}).get(f["id"]), list)]
        note = ""
        if unbaselined:
            note = (
                "\n\nFirst sweep will **baseline** " + ", ".join(unbaselined) + " — every entry "
                "currently on the feed is marked as seen without posting, so the channel does "
                "not fill with years of history. Entries after that get honoured."
            )
        await self.ok(ctx, f"The memorial tracker is **on**.{note}", title="🟢 Memorial on")

    @memorial.command(name="off")
    async def memorial_off(self, ctx: commands.Context):
        """Turn the memorial tracker off."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.send(
            embed=self.embed("📴 Memorial off", "No feeds are polled and nothing is posted.")
        )

    @memorial.command(name="channel")
    async def memorial_channel(self, ctx: commands.Context, channel: discord.TextChannel):
        """Shared fallback channel — feeds without their own post here."""
        await self.config.guild(ctx.guild).channel_id.set(channel.id)
        await self.ok(
            ctx, f"Feeds without their own channel post in {channel.mention}.",
            title="✅ Shared channel set",
        )

    @memorial.command(name="officerschannel", aliases=["officers-channel"])
    async def memorial_officers_channel(self, ctx: commands.Context, channel: discord.TextChannel):
        """Own channel for Fallen Officers entries (wins over the shared one)."""
        await self.config.guild(ctx.guild).odmp_channel_id.set(channel.id)
        await self.ok(ctx, f"🚓 Fallen Officers entries post in {channel.mention}.",
                      title="✅ Officers channel set")

    @memorial.command(name="firefighterschannel", aliases=["firefighters-channel"])
    async def memorial_firefighters_channel(
        self, ctx: commands.Context, channel: discord.TextChannel
    ):
        """Own channel for Fallen Firefighters entries (wins over the shared one)."""
        await self.config.guild(ctx.guild).firehero_channel_id.set(channel.id)
        await self.ok(ctx, f"🚒 Fallen Firefighters entries post in {channel.mention}.",
                      title="✅ Firefighters channel set")

    @memorial.command(name="officersrole", aliases=["officers-role"])
    async def memorial_officers_role(self, ctx: commands.Context, role: discord.Role):
        """Role pinged for Fallen Officers entries."""
        await self.config.guild(ctx.guild).odmp_role_id.set(role.id)
        await self.ok(ctx, f"🚓 Fallen Officers entries ping **{role.name}**.",
                      title="✅ Officers role set")

    @memorial.command(name="firefightersrole", aliases=["firefighters-role"])
    async def memorial_firefighters_role(self, ctx: commands.Context, role: discord.Role):
        """Role pinged for Fallen Firefighters entries."""
        await self.config.guild(ctx.guild).firehero_role_id.set(role.id)
        await self.ok(ctx, f"🚒 Fallen Firefighters entries ping **{role.name}**.",
                      title="✅ Firefighters role set")

    @memorial.command(name="preview")
    async def memorial_preview(self, ctx: commands.Context):
        """Fetch each feed now and show its latest entry. Nothing is posted."""
        async with ctx.typing():
            embed = self.embed("🔍 Feed preview", "Nothing was posted to any channel.")
            for feed in FEEDS:
                items = await self.fetch_items(feed)
                if items is None:
                    value = "⚠️ Unreachable right now."
                else:
                    matching = [i for i in items if item_matches_feed(feed.get("match"), i)]
                    if not matching:
                        value = (
                            f"Reachable — **{len(items)}** item(s), none matching this feed's "
                            "memorial filter."
                        )
                    else:
                        latest = matching[0]
                        link = f"\n{latest['link']}" if latest.get("link") else ""
                        value = (
                            f"**{len(matching)}**/{len(items)} item(s) match.\n"
                            f"Latest: {latest['title']}{link}"
                        )
                embed.add_field(
                    name=f"{feed['emoji']} {feed['title']}", value=value[:1024], inline=False
                )
        await ctx.send(embed=embed)

    @memorial.command(name="probe")
    async def memorial_probe(self, ctx: commands.Context, url: str):
        """Try ANY feed URL live and show what it contains. Posts nothing."""
        async with ctx.typing():
            result = await self.probe(url)
        if not result["ok"]:
            reasons = {
                "bad-url": "That is not an http(s) URL.",
                "http": f"The server answered HTTP **{result.get('status')}**.",
                "unreachable": f"Unreachable: `{result.get('message', '')[:200]}`",
            }
            return await self.nope(ctx, reasons.get(result["code"], "Could not read that feed."),
                                   title="🚫 Probe failed")
        embed = self.embed("🔍 Probe", f"`{url}` parsed **{result['total']}** item(s).")
        for sample in result["sample"]:
            embed.add_field(
                name=sample["title"][:256] or "(untitled)",
                value=(sample["link"] or "_no link_")[:1024],
                inline=False,
            )
        await ctx.send(embed=embed)

    @memorial.command(name="resetbaseline")
    @checks.is_owner()
    async def memorial_resetbaseline(self, ctx: commands.Context, feed_id: Optional[str] = None):
        """Forget which entries were seen, so the next sweep baselines again.

        Use after changing a feed's channel if you want a clean start. It does
        NOT post history — the next sweep re-baselines silently.
        """
        known = [f["id"] for f in FEEDS]
        if feed_id and feed_id not in known:
            return await self.nope(ctx, "Pick one of: " + ", ".join(f"`{i}`" for i in known),
                                   title="🚫 Unknown feed")
        async with self.config.guild(ctx.guild).seen() as seen:
            if feed_id:
                seen.pop(feed_id, None)
            else:
                seen.clear()
        await self.ok(
            ctx,
            f"Baseline cleared for **{feed_id or 'every feed'}**. The next sweep records what "
            "is on the feed now, without posting it.",
            title="✅ Baseline reset",
        )

    @memorial.command(name="migratecuff")
    @checks.is_owner()
    async def memorial_migratecuff(
        self, ctx: commands.Context, mode: str = "apply", path: str = LIVE_NODE_JSON
    ):
        """Migrate settings and seen-entry history from the CuffBot Node data file."""
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
        node = data.get("memorialConfig")
        if isinstance(node, dict):
            if "enabled" in node:
                changes["enabled"] = bool(node["enabled"])
            for node_key, our_key in (
                ("channelId", "channel_id"),
                ("odmpChannelId", "odmp_channel_id"),
                ("fireheroChannelId", "firehero_channel_id"),
                ("odmpRoleId", "odmp_role_id"),
                ("fireheroRoleId", "firehero_role_id"),
            ):
                if node_key in node:
                    value = node[node_key]
                    changes[our_key] = int(value) if value else None

        # Carrying the seen ids across is what stops the first Red sweep from
        # re-posting entries the Node bot already honoured.
        node_seen = data.get("memorialSeen")
        if isinstance(node_seen, dict) and node_seen:
            changes["seen"] = {
                str(feed_id): list(ids)
                for feed_id, ids in node_seen.items()
                if isinstance(ids, list)
            }

        if not changes:
            return await ctx.send(
                embed=self.embed("ℹ️ Nothing to migrate", "No memorial keys in that file.")
            )
        summary = "\n".join(
            f"{key} = {value if not isinstance(value, dict) else {k: len(v) for k, v in value.items()}}"
            for key, value in changes.items()
        )
        if mode == "preview":
            return await ctx.send(
                embed=self.embed(
                    "🔍 Memorial migration preview",
                    f"Nothing written. Run with `apply` to commit.\n```\n{summary}\n```",
                )
            )
        group = self.config.guild(ctx.guild)
        for key, value in changes.items():
            await group.get_attr(key).set(value)
        await self.ok(ctx, f"Migrated from `{path}`:\n```\n{summary}\n```",
                      title="✅ Migration applied")
