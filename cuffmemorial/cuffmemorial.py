"""CuffMemorial — the fallen-heroes tracker.

Port of the CuffBot Node module ``src/modules/memorial``. Polls the memorial
feeds in ``FEEDS`` every 30 minutes and honours new entries in the channel
that feed is set to, tagging its role.

Adding a feed is a ``FEEDS`` entry and nothing else: the channel and role
config keys, the setup commands and the commands' feed ids all come off that
list. What differs per source is declared there too, because no two of these
feeds describe a death the same way — one hides the name in a URL slug,
another packs the whole record into the title, a third keeps the photo on the
article page.

Rules carried over, each the result of something going wrong once:

* **A feed baselines on first sight.** The first successful fetch marks every
  current item as seen *without posting*. A fresh install must honour the
  fallen going forward, not dump years of history into a channel.
* **Unreachable is not empty.** A fetch failure returns nothing at all rather
  than an empty item list, so a timeout can never be mistaken for "the feed
  baselined with zero items" and wipe the tracker's memory.
* **firehero.org has no memorial-only feed.** Its feed carries all site news,
  so only items whose link points at a hero profile are honoured. Plain news
  is filtered out and never posted.
* **odmp.org's ``<title>`` is the agency, not the officer.** The name is
  rebuilt from the profile slug and the portrait is pulled out of the
  description HTML, because posting a memorial headed "Lynn Police Department
  (IN)" with no face is not honouring anyone.
* **cpof.org rate limits page loads.** Its portraits are on the article page
  rather than in the feed, so those pages are read one at a time with a gap
  and one retry. A photo is worth waiting for; it is never worth failing over.

The role ping here is deliberate — it is the one intentional ping in the
precinct, and it exists because people asked to be told.
"""

import asyncio
import json
import logging
import re
import time
from datetime import timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp
import discord
from discord.ext import tasks
from redbot.core import Config, checks, commands
from redbot.core.bot import Red

from .rss import (
    item_matches_feed,
    merge_seen,
    name_from_link,
    parse_feed,
    shorten,
    strip_html,
    unseen_items,
)

log = logging.getLogger("red.cuff-cogs.cuffmemorial")

LIVE_NODE_JSON = "/home/brand/CuffBot/data/411157175948541954.json"

MEMORIAL_COLOR = 0x2C3E50
SUCCESS_COLOR = 0x57F287
ERROR_COLOR = 0xED4245

SWEEP_MINUTES = 30
FETCH_TIMEOUT_S = 20
#: How much of the item's own text the embed carries. Long enough for the
#: circumstances, short enough that the photo stays on screen with it.
SUMMARY_CHARS = 700
#: Closing line under the text, linking to the source. What is worth reading
#: there differs per source, so each feed names its own; this is the fallback.
DEFAULT_LINK_TEXT = "Read the full story"
#: How many entries a hand-run command may post at once, and how many a
#: backfill takes when no number is given.
MAX_MANUAL = 10
DEFAULT_BACKFILL = 5
#: Minimum seconds between two page fetches, measured against cpof.org's own
#: rate limit (a few per minute, 429 beyond that).
SCRAPE_GAP_S = 20
#: Self-identifying, but Mozilla-shaped: cpof.org's WAF answers 429 to every
#: user agent that does not start with the usual token, whatever the rate.
USER_AGENT = (
    "Mozilla/5.0 (compatible; CuffBot/1.0; +https://github.com/Brandjuh/Cuffbot) "
    "memorial-feed-reader"
)

#: Owner decision (2026-08-01): every feed posts in the one memorial channel.
#: Move a single feed out with `memorial feedchannel <id> #chan`.
MEMORIAL_CHANNEL_ID = 451095508560379934

#: Owner's ping roles, one per kind of service rather than one per feed: three
#: of these feeds report firefighter deaths and share a role.
ROLE_FALLEN_POLICE = 627946543273738240
ROLE_FALLEN_FIREFIGHTER = 627946690024046675
ROLE_CORRECTIONAL_OFFICER = 1533202959624830976

#: Owner-specified sources. The ids are the owner's own guild roles/channels,
#: committed as product config the same way the Node module had them.
FEEDS: List[Dict[str, Any]] = [
    {
        "id": "firehero",
        "title": "Fallen Firefighters",
        "emoji": "🚒",
        "url": "https://www.firehero.org/feed/",
        "role_id": ROLE_FALLEN_FIREFIGHTER,
        "default_channel_id": MEMORIAL_CHANNEL_ID,
        # Hero profiles live under /fallen-firefighter/; everything else on
        # that feed is site news and must never be posted as a memorial.
        "match": {"link_includes": ["/fallen-firefighter"]},
        "link_text": "Read their full profile",
        # Its <title> already is the firefighter's name.
        "name_from_link": False,
        "title_is_agency": False,
        "logo_hint": None,
        "image_upgrade": None,
    },
    {
        "id": "usfa",
        "title": "USFA Firefighter Fatalities",
        "emoji": "🇺🇸",
        "url": "https://apps.usfa.fema.gov/firefighter-fatalities/api/fatalityDatums/feed",
        "role_id": ROLE_FALLEN_FIREFIGHTER,
        "match": None,
        "default_channel_id": MEMORIAL_CHANNEL_ID,
        # This feed is nothing but a title, and the title is the whole record:
        # "Jul 24, 2026: Nathan Matthews, Helitack Crewmember - Rifle, CO".
        # Greedy rank so the split lands on the LAST " - ", before the place.
        "title_pattern": (
            r"^\s*(?P<eow>[^:]+?)\s*:\s*(?P<name>[^,]+?)\s*,\s*"
            r"(?P<rank>.+)\s+-\s+(?P<location>.+?)\s*$"
        ),
        "pattern_fields": (("Rank", "rank"), ("Location", "location")),
        "link_text": "Read the full fatality notice",
        # USFA publishes no photograph anywhere — not in the feed, not in the
        # API, not on the page. What it does have is the record behind the
        # notice, which turns a line of facts into an account of what happened.
        "api": {
            "url": "https://apps.usfa.fema.gov/firefighter-fatalities/api/fatalityDatums/{id}",
            "id_from_link": r"[?&]id=(\d+)",
            "shape": "usfa",
        },
    },
    {
        "id": "iaff",
        "title": "IAFF Line of Duty Deaths",
        "emoji": "⚒️",
        "url": "https://www.iaff.org/feed/?post_type=iaff-lodd",
        "role_id": ROLE_FALLEN_FIREFIGHTER,
        "match": None,
        "default_channel_id": MEMORIAL_CHANNEL_ID,
        # <title> is the name; the description is the local and where they
        # served ("L2548, Greenfield, MA"), which reads as a field, not prose.
        "summary_field": "Local",
        "link_text": "View their line-of-duty-death profile",
        # iaff.org sits behind Cloudflare, which refuses aiohttp on its TLS
        # fingerprint alone — every user agent gets 403, while curl on this
        # same machine gets 200. So this one feed is read with curl.
        "fetch_via": "curl",
    },
    {
        "id": "cpof",
        "title": "Correctional Officers Down",
        "emoji": "🔗",
        "url": "https://cpof.org/category/line-of-duty-death/feed/",
        "role_id": ROLE_CORRECTIONAL_OFFICER,
        "match": None,
        "default_channel_id": MEMORIAL_CHANNEL_ID,
        # Articles, not profiles: the headline is written by a person and
        # already carries the name and rank, so it is left as the title.
        #
        # The portrait is on the article page but not in the feed, so it is
        # fetched from the entry's own page. Every uploads image on those pages
        # is the person, except the site furniture named below.
        "page_image": {
            "pattern": r"https://cpof\.org/wp-content/uploads/\d{4}/\d{2}/[^\"'\s>]+?\.(?:jpg|jpeg|png)",
            "exclude": ("logo", "icon", "slogan", "banner"),
        },
        # Their articles open with "End of Watch: July 31, 2025" — that is a
        # field, not the first line of the story.
        "eow_in_summary": r"End of Watch:\s*([A-Za-z]+ \d{1,2},? \d{4})",
        "link_text": "Read the full tribute",
    },
    {
        "id": "odmp",
        "title": "Fallen Officers",
        "emoji": "🚓",
        "url": "https://www.odmp.org/feed",
        "role_id": ROLE_FALLEN_POLICE,
        "match": None,
        "default_channel_id": MEMORIAL_CHANNEL_ID,
        # odmp.org puts the *agency* in <title> and the officer's name in the
        # profile slug, so the embed title has to be rebuilt from the link.
        "name_from_link": True,
        "title_is_agency": True,
        # Each item carries the portrait first and the agency badge second;
        # the badge is the one under /agency/, the portrait is the other one.
        "logo_hint": "/agency/",
        # The feed links a 50px thumbnail. The same file exists at larger
        # sizes, and 50px stretched across an embed is not a portrait.
        "image_upgrade": ("/thumb/50/", "/thumb/400/"),
        "link_text": "Read their full memorial",
    },
]

FEEDS_BY_ID: Dict[str, Dict[str, Any]] = {f["id"]: f for f in FEEDS}


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
        #: Every feed gets its own channel and role key, so adding a feed to
        #: FEEDS is the only edit adding a feed needs.
        per_feed: Dict[str, Any] = {}
        for feed in FEEDS:
            per_feed[f"{feed['id']}_channel_id"] = feed.get("default_channel_id")
            per_feed[f"{feed['id']}_role_id"] = None  # None = the FEEDS default
        self.config.register_guild(
            #: The live Node config had this off. Ported as-is — switching a
            #: pinging feed on is the admin's call, not the porter's.
            enabled=False,
            channel_id=None,  # shared fallback
            **per_feed,
            #: feed id -> [seen item ids]. A feed absent here has never been
            #: baselined, which is what triggers the no-post first fetch.
            seen={},
            #: feed id -> [item ids this bot actually put in a channel]. Not the
            #: same thing as seen: baselining marks entries seen *without*
            #: posting them. A backfill needs that difference — those are
            #: exactly the entries it exists to place.
            posted={},
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

    @staticmethod
    async def fetch_via_curl(url: str) -> Optional[str]:
        """Read a URL with curl. For sites aiohttp cannot get past.

        iaff.org is behind Cloudflare, which answers 403 to aiohttp on its TLS
        fingerprint no matter what headers are sent, while curl on the very
        same machine and IP is served normally. The argument list is fixed and
        the URL comes from FEEDS, so nothing here is shell-interpreted.
        """
        try:
            process = await asyncio.create_subprocess_exec(
                "curl", "-sL", "--max-time", str(FETCH_TIMEOUT_S), "-A", USER_AGENT, url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await asyncio.wait_for(
                process.communicate(), timeout=FETCH_TIMEOUT_S + 10
            )
        except (OSError, asyncio.TimeoutError) as error:
            log.warning("Memorial: curl failed for %s (%s)", url, error)
            return None
        if process.returncode != 0 or not stdout:
            return None
        return stdout.decode("utf-8", "replace")

    async def fetch_text(self, feed: Dict[str, Any]) -> Optional[str]:
        """The feed document, by whichever route this feed needs."""
        if feed.get("fetch_via") == "curl":
            return await self.fetch_via_curl(feed["url"])
        session = await self.session()
        timeout = aiohttp.ClientTimeout(total=FETCH_TIMEOUT_S)
        async with session.get(feed["url"], timeout=timeout) as response:
            if response.status != 200:
                log.warning("Memorial: %s feed returned HTTP %s", feed["id"], response.status)
                return None
            return await response.text()

    async def fetch_items(self, feed: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
        """Items for one feed, or **None** on any failure.

        The None-vs-empty distinction matters: callers must be able to tell
        "reachable but nothing matches" from "unreachable", because only the
        first one is allowed to baseline the feed.
        """
        try:
            document = await self.fetch_text(feed)
        except Exception as error:
            log.warning("Memorial: %s feed unreachable (%s)", feed["id"], error)
            return None
        return None if document is None else parse_feed(document)

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

    # ------------------------------------------------------------------
    # Turning an item into an embed
    # ------------------------------------------------------------------

    @staticmethod
    def title_parts(feed: Dict[str, Any], item: Dict[str, Any]) -> Dict[str, str]:
        """Pull a feed's ``title_pattern`` apart into its named groups.

        Some feeds carry no description at all and pack everything into the
        title — usfa.fema.gov posts nothing but
        "Jul 24, 2026: Nathan Matthews, Helitack Crewmember - Rifle, CO".
        A title that does not match the pattern simply yields nothing.
        """
        pattern = feed.get("title_pattern")
        if not pattern:
            return {}
        match = re.match(pattern, str(item.get("title") or ""))
        return {k: v.strip() for k, v in (match.groupdict() if match else {}).items() if v}

    @classmethod
    def display_name(cls, feed: Dict[str, Any], item: Dict[str, Any]) -> str:
        """Whose name goes on the embed."""
        name = cls.title_parts(feed, item).get("name")
        if name:
            return name
        if feed.get("name_from_link"):
            name = name_from_link(item.get("link"), item.get("summary"))
            if name:
                return name
        return item.get("title") or "(untitled)"

    @staticmethod
    def _sized(feed: Dict[str, Any], url: Optional[str]) -> Optional[str]:
        upgrade = feed.get("image_upgrade")
        if url and upgrade and upgrade[0] in url:
            return url.replace(upgrade[0], upgrade[1])
        return url

    @classmethod
    def logo_url(cls, feed: Dict[str, Any], item: Dict[str, Any]) -> Optional[str]:
        """The agency badge, if this feed attaches one."""
        hint = feed.get("logo_hint")
        if not hint:
            return None
        images = [str(u) for u in (item.get("images") or [])]
        return cls._sized(feed, next((u for u in images if hint in u), None))

    @classmethod
    def photo_url(cls, feed: Dict[str, Any], item: Dict[str, Any]) -> Optional[str]:
        """The portrait: the first image that is not the agency badge.

        Defined by exclusion rather than by a path, because odmp.org files
        portraits under whichever section the fallen belong to — ``/officer/``
        for people, ``/k9/`` for dogs — and a K9 deserves their photo too.
        """
        hint = feed.get("logo_hint")
        images = [str(u) for u in (item.get("images") or [])]
        return cls._sized(feed, next((u for u in images if not hint or hint not in u), None))

    def memorial_embed(self, feed: Dict[str, Any], item: Dict[str, Any]) -> discord.Embed:
        """Name, their story, their photo — in that order."""
        parts = self.title_parts(feed, item)
        summary = str(item.get("summary") or "").strip()
        # An end-of-watch line buried in the opening sentence belongs in a
        # field, and should not be read twice.
        eow_in_summary = feed.get("eow_in_summary")
        found_eow = re.search(eow_in_summary, summary) if eow_in_summary and summary else None
        if found_eow:
            summary = (summary[: found_eow.start()] + summary[found_eow.end() :]).strip()
        # A one-line description ("L2548, Greenfield, MA") is a fact, not a
        # story, so those feeds show it as a labelled field instead.
        summary_field = feed.get("summary_field")
        link = item.get("link") or ""
        has_link = link.lower().startswith(("http://", "https://"))
        body = shorten(summary, SUMMARY_CHARS) if summary and not summary_field else ""
        if has_link:
            # The title is already a link, but a cut-off account needs to say
            # so and say where the rest of it is. Angle brackets keep query
            # strings from breaking the markdown.
            read_more = f"[{feed.get('link_text') or DEFAULT_LINK_TEXT} →](<{link}>)"
            body = f"{body}\n\n{read_more}" if body else read_more

        embed = discord.Embed(
            color=MEMORIAL_COLOR,
            title=f"🕯️ {feed['emoji']} {self.display_name(feed, item)}"[:256],
            description=body or None,
        )
        if has_link:
            embed.url = link

        if feed.get("title_is_agency") and item.get("title"):
            embed.add_field(name="Agency", value=str(item["title"])[:1024], inline=True)
        for label, group in feed.get("pattern_fields") or ():
            if parts.get(group):
                embed.add_field(name=label, value=parts[group][:1024], inline=True)
        for label, value in item.get("extra_fields") or ():
            embed.add_field(name=str(label), value=str(value)[:1024], inline=True)
        if summary_field and summary:
            embed.add_field(name=summary_field, value=summary[:1024], inline=True)
        end_of_watch = (
            item.get("end_of_watch")
            or parts.get("eow")
            or (found_eow.group(1) if found_eow else None)
        )
        if end_of_watch:
            embed.add_field(name="End of watch", value=str(end_of_watch)[:1024], inline=True)

        photo = self.photo_url(feed, item)
        if photo:
            embed.set_image(url=photo)
        logo = self.logo_url(feed, item)
        if logo:
            embed.set_thumbnail(url=logo)

        embed.set_footer(text=f"{feed['title']} — gone, but not forgotten.")
        if item.get("pub_date"):
            try:
                stamp = parsedate_to_datetime(str(item["pub_date"]))
                embed.timestamp = (
                    stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)
                )
            except (TypeError, ValueError):
                pass
        return embed

    async def pace_scrape(self):
        """Keep at least ``SCRAPE_GAP_S`` between two page fetches.

        cpof.org answers 429 to a handful of page loads in quick succession.
        The sweep never notices — it reads one page every 30 minutes — but a
        hand-run backfill of five would trip it, so the burst is slowed down
        instead of being allowed to fail.
        """
        waited = time.monotonic() - getattr(self, "_scraped_at", 0.0)
        if 0 < waited < SCRAPE_GAP_S:
            await asyncio.sleep(SCRAPE_GAP_S - waited)
        self._scraped_at = time.monotonic()

    async def scrape_image(self, feed: Dict[str, Any], item: Dict[str, Any]) -> Optional[str]:
        """Look for a portrait on the entry's own page. Best effort, never raises.

        Some sources keep the photo on the page and out of the feed. One extra
        GET for an entry that is about to be posted is a fair price for a face
        on the memorial; anything going wrong just means no photo.
        """
        rule = feed.get("page_image")
        link = str(item.get("link") or "")
        if not rule or not link.lower().startswith(("http://", "https://")):
            return None
        if not hasattr(self, "_scrape_cache"):
            self._scrape_cache: Dict[str, str] = {}
        if link in self._scrape_cache:
            return self._scrape_cache[link] or None

        html = None
        for attempt in (1, 2):
            try:
                await self.pace_scrape()
                session = await self.session()
                timeout = aiohttp.ClientTimeout(total=FETCH_TIMEOUT_S)
                async with session.get(link, timeout=timeout) as response:
                    if response.status == 429 and attempt == 1:
                        # Rate limited: wait out the window and try once more.
                        retry_after = response.headers.get("Retry-After")
                        delay = int(retry_after) if str(retry_after or "").isdigit() else SCRAPE_GAP_S
                        log.debug("Memorial: %s rate limited, retrying in %ss", link, delay)
                        await asyncio.sleep(min(delay, FETCH_TIMEOUT_S * 3))
                        continue
                    if response.status != 200:
                        return None
                    html = await response.text()
                    break
            except Exception as error:
                log.debug("Memorial: no page image for %s (%s)", link, error)
                return None
        if html is None:
            return None

        found = self.pick_page_image(rule, html)
        if found:
            self._scrape_cache[link] = found
        return found

    @staticmethod
    def pick_page_image(rule: Dict[str, Any], html: str) -> Optional[str]:
        """The first image on a page that is the person rather than furniture."""
        exclude = tuple(str(w).lower() for w in (rule.get("exclude") or ()))
        for url in re.findall(rule["pattern"], html or ""):
            if not any(word in url.lower() for word in exclude):
                return url
        return None

    @staticmethod
    def usfa_record(item: Dict[str, Any], data: Dict[str, Any]) -> Dict[str, Any]:
        """Fold a USFA fatality record into the item.

        The notice feed carries only a title. The record behind it holds what
        actually happened, the department they served, their age and how long
        they served — the difference between a line of facts and a memorial.
        """
        merged = dict(item)
        summary = strip_html(data.get("initialSummary"))
        if summary:
            merged["summary"] = summary
        extra = []
        if data.get("fdName"):
            extra.append(("Department", str(data["fdName"])))
        if data.get("age"):
            extra.append(("Age", str(data["age"])))
        if data.get("serviceYrs"):
            years = data["serviceYrs"]
            extra.append(("Served", f"{years} year{'' if years == 1 else 's'}"))
        merged["extra_fields"] = extra
        return merged

    async def enrich_from_api(self, feed: Dict[str, Any], item: Dict[str, Any]) -> Dict[str, Any]:
        """Item plus whatever its source's own record adds. Never raises."""
        rule = feed.get("api")
        if not rule:
            return item
        found_id = re.search(rule["id_from_link"], str(item.get("link") or ""))
        if not found_id:
            return item
        try:
            session = await self.session()
            timeout = aiohttp.ClientTimeout(total=FETCH_TIMEOUT_S)
            async with session.get(rule["url"].format(id=found_id.group(1)), timeout=timeout) as response:
                if response.status != 200:
                    return item
                data = json.loads(await response.text())
        except Exception as error:
            log.debug("Memorial: no %s record for %s (%s)", feed["id"], item.get("link"), error)
            return item
        if not isinstance(data, dict):
            return item
        return self.usfa_record(item, data) if rule.get("shape") == "usfa" else item

    async def build_embed(self, feed: Dict[str, Any], item: Dict[str, Any]) -> discord.Embed:
        """The memorial embed, with everything the source will give up.

        Two sources hold back what the feed itself does not carry: usfa.fema.gov
        keeps the account in its API, cpof.org keeps the portrait on the page.
        Both are fetched here, so every route to a post gets the same embed.
        """
        item = await self.enrich_from_api(feed, item)
        if feed.get("page_image") and not item.get("images"):
            found = await self.scrape_image(feed, item)
            if found:
                item = {**item, "images": [found]}
        return self.memorial_embed(feed, item)

    async def deliver(
        self,
        channel: Any,
        feed: Dict[str, Any],
        item: Dict[str, Any],
        ping_role_id: Optional[int],
    ) -> bool:
        """Post one memorial. ``False`` means the channel refused it.

        The single place a memorial reaches Discord, so the sweep and a manual
        post cannot drift apart in how one looks. ``ping_role_id`` of ``None``
        is the silent form: no role is named and nothing can be mentioned.
        """
        try:
            await channel.send(
                content=f"<@&{ping_role_id}>" if ping_role_id else None,
                embed=await self.build_embed(feed, item),
                allowed_mentions=(
                    discord.AllowedMentions(roles=[discord.Object(id=ping_role_id)])
                    if ping_role_id
                    else discord.AllowedMentions.none()
                ),
            )
        except discord.HTTPException as error:
            log.warning("Memorial: post failed for %s (%s)", feed["id"], error)
            return False
        return True

    @staticmethod
    async def remember(group: Any, feed: Dict[str, Any], item_id: str):
        """Record one entry as both seen and actually posted."""
        async with group.seen() as seen:
            seen[feed["id"]] = merge_seen(seen.get(feed["id"]), [item_id])
        async with group.posted() as posted:
            posted[feed["id"]] = merge_seen(posted.get(feed["id"]), [item_id])

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
                if not await self.deliver(channel, feed, item, ping_role_id):
                    break  # channel is broken right now; retry the rest later
                posted += 1
                # Marked seen per successful post, so a failure retries.
                await self.remember(group, feed, item["id"])
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
                f"`{ctx.clean_prefix}memorial feedchannel <feed> #chan` · `feedrole <feed> @role`\n"
                f"`{ctx.clean_prefix}memorial preview` — fetch now, post nothing\n"
                f"`{ctx.clean_prefix}memorial test [feed] [count]` — post the real embed here\n"
                f"`{ctx.clean_prefix}memorial backfill [feed] [count]` — last 5 for real, no ping\n"
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

    @memorial.command(name="feedchannel", aliases=["feed-channel"])
    async def memorial_feed_channel(
        self, ctx: commands.Context, feed_id: str, channel: discord.TextChannel
    ):
        """Own channel for any feed by id — `[p]memorial feedchannel usfa #chan`."""
        feed = FEEDS_BY_ID.get(feed_id.lower())
        if not feed:
            return await self.unknown_feed(ctx)
        await self.config.guild(ctx.guild).get_attr(f"{feed['id']}_channel_id").set(channel.id)
        await self.ok(
            ctx, f"{feed['emoji']} **{feed['title']}** entries post in {channel.mention}.",
            title="✅ Channel set",
        )

    @memorial.command(name="feedrole", aliases=["feed-role"])
    async def memorial_feed_role(
        self, ctx: commands.Context, feed_id: str, role: discord.Role
    ):
        """Ping role for any feed by id — `[p]memorial feedrole usfa @role`."""
        feed = FEEDS_BY_ID.get(feed_id.lower())
        if not feed:
            return await self.unknown_feed(ctx)
        await self.config.guild(ctx.guild).get_attr(f"{feed['id']}_role_id").set(role.id)
        await self.ok(
            ctx, f"{feed['emoji']} **{feed['title']}** entries ping **{role.name}**.",
            title="✅ Role set",
        )

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
                        photo = self.photo_url(feed, latest) or await self.scrape_image(
                            feed, latest
                        )
                        value = (
                            f"**{len(matching)}**/{len(items)} item(s) match.\n"
                            f"Latest: **{self.display_name(feed, latest)}**\n"
                            f"Photo: {photo or '⚠️ none in this item'}\n"
                            f"{latest.get('link') or ''}"
                        )
                embed.add_field(
                    name=f"{feed['emoji']} {feed['title']}", value=value[:1024], inline=False
                )
        await ctx.send(embed=embed)

    @staticmethod
    def feeds_and_count(
        first: Optional[str], second: Optional[int], default_count: int
    ) -> Any:
        """Read ``[feed] [count]`` where either may be left out.

        So ``odmp 3``, ``3`` and nothing at all all mean what they look like.
        Returns ``(feeds, count)``, or ``(None, count)`` for an unknown feed id.
        """
        count = default_count
        feeds = FEEDS
        if first and str(first).isdigit():
            count = int(first)
        elif first:
            feeds = [f for f in FEEDS if f["id"] == str(first).lower()]
            if not feeds:
                return None, default_count
        if second is not None:
            count = int(second)
        return feeds, max(1, min(count, MAX_MANUAL))

    async def unknown_feed(self, ctx: commands.Context):
        await self.nope(
            ctx,
            "Pick one of: " + ", ".join(f"`{f['id']}`" for f in FEEDS),
            title="🚫 Unknown feed",
        )

    @memorial.command(name="test")
    async def memorial_test(
        self,
        ctx: commands.Context,
        feed_id: Optional[str] = None,
        count: Optional[int] = None,
    ):
        """Post the newest entries **here** exactly as the tracker would.

        For checking how a memorial looks before it goes to the real channel,
        so run it somewhere private. The embeds are the real ones, but this
        pings nobody, marks nothing as seen and touches no other channel — the
        next real sweep still honours these entries where it should.

        `[p]memorial test` · `[p]memorial test 3` · `[p]memorial test odmp 3`
        """
        feeds, count = self.feeds_and_count(feed_id, count, 1)
        if feeds is None:
            return await self.unknown_feed(ctx)

        async with ctx.typing():
            for feed in feeds:
                items = await self.fetch_items(feed)
                if items is None:
                    await self.nope(
                        ctx, f"{feed['emoji']} **{feed['title']}** is unreachable right now.",
                        title="🚫 Feed down",
                    )
                    continue
                matching = [i for i in items if item_matches_feed(feed.get("match"), i)]
                if not matching:
                    await ctx.send(
                        embed=self.embed(
                            f"{feed['emoji']} {feed['title']}",
                            f"Reachable — **{len(items)}** item(s), none of them a memorial "
                            "entry right now, so there is nothing to preview.",
                        )
                    )
                    continue

                role_id = self.role_id_for(
                    await self.config.guild(ctx.guild).all(), feed
                )
                for item in matching[:count]:
                    await ctx.send(
                        # Shown as plain text so you can see which role the real
                        # post would ping, without pinging it.
                        content=f"🧪 test — would ping <@&{role_id}>" if role_id else "🧪 test",
                        embed=await self.build_embed(feed, item),
                        allowed_mentions=discord.AllowedMentions.none(),
                    )

    @memorial.command(name="backfill")
    async def memorial_backfill(
        self,
        ctx: commands.Context,
        feed_id: Optional[str] = None,
        count: Optional[int] = None,
    ):
        """Post the last few entries in the **real** channel, without pinging.

        For catching up a channel that was baselined empty: the newest entries
        go in oldest-first, exactly as the tracker posts them but silently —
        nobody gets pinged for a memorial they may already know about.

        Baselined entries are placed, not skipped: being marked seen only means
        the tracker knows about them, and the whole reason this command exists
        is that they were never actually posted. Only entries this bot has
        really put in a channel before are skipped, so running it twice does
        not give anyone two memorials.

        `[p]memorial backfill` (last 5, every feed) · `[p]memorial backfill odmp 3`
        """
        feeds, count = self.feeds_and_count(feed_id, count, DEFAULT_BACKFILL)
        if feeds is None:
            return await self.unknown_feed(ctx)

        group = self.config.guild(ctx.guild)
        conf = await group.all()
        report = self.embed(
            "🕯️ Backfill",
            f"The newest **{count}** entr{'y' if count == 1 else 'ies'} per feed, "
            "posted without a ping.",
        )

        async with ctx.typing():
            for feed in feeds:
                channel_id = self.channel_id_for(conf, feed)
                channel = ctx.guild.get_channel(channel_id) if channel_id else None
                if not isinstance(channel, (discord.TextChannel, discord.Thread)):
                    report.add_field(
                        name=f"{feed['emoji']} {feed['title']}",
                        value="⚠️ No channel configured — nothing posted.",
                        inline=False,
                    )
                    continue
                if not channel.permissions_for(ctx.guild.me).send_messages:
                    report.add_field(
                        name=f"{feed['emoji']} {feed['title']}",
                        value=f"⚠️ I cannot post in {channel.mention}.",
                        inline=False,
                    )
                    continue

                items = await self.fetch_items(feed)
                if items is None:
                    report.add_field(
                        name=f"{feed['emoji']} {feed['title']}",
                        value="⚠️ Feed unreachable right now — nothing posted.",
                        inline=False,
                    )
                    continue
                matching = [i for i in items if item_matches_feed(feed.get("match"), i)]
                baselined = isinstance((conf["seen"] or {}).get(feed["id"]), list)
                already_posted = set((conf.get("posted") or {}).get(feed["id"]) or ())

                newest = matching[:count]
                fresh = [i for i in newest if i["id"] not in already_posted]
                skipped = len(newest) - len(fresh)

                posted, broke = 0, False
                for item in reversed(fresh):  # oldest first, so it reads in order
                    if not await self.deliver(channel, feed, item, None):
                        broke = True
                        break
                    posted += 1
                    await self.remember(group, feed, item["id"])

                note = ""
                if broke:
                    note = "\n⚠️ The channel stopped accepting posts partway through."
                if not baselined and not broke:
                    # This feed had never been baselined, so every *other* entry
                    # on it is still unseen — and the next sweep would post that
                    # backlog, with pings. Mark the rest known now: the whole
                    # point of a backfill is that these were the ones wanted.
                    rest = [i["id"] for i in matching if i["id"] not in {f["id"] for f in fresh}]
                    async with group.seen() as seen:
                        seen[feed["id"]] = merge_seen(seen.get(feed["id"]), rest)
                    note = (
                        f"\nThe other **{len(rest)}** entr{'y' if len(rest) == 1 else 'ies'} "
                        f"on the feed {'is' if len(rest) == 1 else 'are'} now marked as "
                        "seen, so the sweep will not post the backlog."
                    )
                    log.info("Memorial: backfill baselined the rest of %s.", feed["id"])

                lines = [f"Posted **{posted}** in {channel.mention}, no ping."]
                if skipped:
                    lines.append(f"Skipped **{skipped}** already posted earlier.")
                if not posted and not skipped:
                    lines = ["Nothing to post — the feed has no memorial entries."]
                report.add_field(
                    name=f"{feed['emoji']} {feed['title']}",
                    value=("\n".join(lines) + note)[:1024],
                    inline=False,
                )

        await ctx.send(embed=report, allowed_mentions=discord.AllowedMentions.none())

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
