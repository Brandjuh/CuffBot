"""CuffMemorial: feed parsing and the embed a fallen hero gets.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_memorial.py

No network: the fixtures below are trimmed copies of what odmp.org and
firehero.org actually served on 2026-08-01, kept verbatim down to the double
CDATA sections and the &apos; entities, because those are exactly the shapes
that used to break parsing.
"""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import discord

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cuffmemorial.cuffmemorial import (
    FEEDS,
    FEEDS_BY_ID,
    MAX_MANUAL,
    MEMORIAL_CHANNEL_ID,
    ROLE_CORRECTIONAL_OFFICER,
    ROLE_FALLEN_FIREFIGHTER,
    ROLE_FALLEN_POLICE,
    SUMMARY_CHARS,
    USER_AGENT,
    CuffMemorial,
)
from cuffmemorial.rss import (
    extract_images,
    item_matches_feed,
    name_from_link,
    parse_feed,
    shorten,
    strip_html,
)

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


ODMP_XML = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:endofwatch="http://odmp.org/feed">
 <channel>
  <title>Officer Down Memorial Page (ODMP)</title>
  <item>
   <title>Lexington County Sheriff's Department (SC)</title>
   <endofwatch>July 30, 2026</endofwatch>
   <link>https://www.odmp.org/officer/27881-master-deputy-sheriff-jillian-olson</link>
   <guid>https://www.odmp.org/officer/27881-master-deputy-sheriff-jillian-olson</guid>
   <description><![CDATA[<img src="https://www.odmp.org/media/thumb/50/officer/27881/c_olson_jillian.jpg" /> ]]><![CDATA[<img src="https://www.odmp.org/media/thumb/50/agency/2140/lexington-county-sheriffs-department.png" /> ]]>Master Deputy Sheriff Jillian Olson was killed during an underwater training exercise on Lake Murray.

Master Deputy Olson had served with the Lexington County Sheriff&apos;s Department for five years. Survivors include...</description>
   <pubDate>Sat, 01 Aug 2026 15:04:26 +0000</pubDate>
  </item>
  <item>
   <title>Lynn Police Department (IN)</title>
   <endofwatch>July 29, 2026</endofwatch>
   <link>https://www.odmp.org/officer/27878-town-marshal-brad-fisher</link>
   <guid>https://www.odmp.org/officer/27878-town-marshal-brad-fisher</guid>
   <description><![CDATA[<img src="https://www.odmp.org/media/thumb/50/officer/27878/fisher-brad1.jpg" /> ]]>Town Marshal Brad Fisher was killed assisting in the pursuit of a stolen vehicle.</description>
   <pubDate>Wed, 29 Jul 2026 22:10:33 +0000</pubDate>
  </item>
  <item>
   <title>Schenectady County Sheriff's Office (NY)</title>
   <endofwatch>July 2, 2026</endofwatch>
   <link>https://www.odmp.org/k9/1970-k9-leonidas</link>
   <guid>https://www.odmp.org/k9/1970-k9-leonidas</guid>
   <description><![CDATA[<img src="https://www.odmp.org/media/thumb/50/k9/1970/c_leonidas-2.jpg" /> ]]><![CDATA[<img src="https://www.odmp.org/media/thumb/50/agency/7952/schenectady-county-sheriffs-office.png" /> ]]>K9 Leonidas succumbed to heatstroke after the patrol vehicle&apos;s alarm system failed to operate.</description>
   <pubDate>Thu, 03 Jul 2026 12:00:00 +0000</pubDate>
  </item>
 </channel>
</rss>"""

FIREHERO_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
 <channel>
  <item>
   <title>Firefighter After Action Review Podcast: Marshalls Creek (Part 1)</title>
   <link>https://www.firehero.org/2026/08/01/firefighter-after-action-review-marshalls-creek-1/</link>
   <pubDate>Sat, 01 Aug 2026 04:01:04 +0000</pubDate>
   <guid isPermaLink="false">https://www.firehero.org/?p=203536</guid>
   <description><![CDATA[<p>In 1964, a devastating explosion in Marshalls Creek, Pennsylvania, claimed the lives of three firefighters.</p>
<p>The post <a rel="nofollow" href="https://www.firehero.org/2026/08/01/x/">Marshalls Creek</a> appeared first on <a rel="nofollow" href="https://www.firehero.org">National Fallen Firefighters Foundation</a>.</p>
]]></description>
   <enclosure url="https://player.vimeo.com/x.mp4" length="0" type="video/mp4" />
  </item>
  <item>
   <title>Firefighter Dana Rivers</title>
   <link>https://www.firehero.org/fallen-firefighter/dana-rivers/</link>
   <pubDate>Thu, 31 Jul 2026 09:00:00 +0000</pubDate>
   <guid isPermaLink="false">https://www.firehero.org/?p=203400</guid>
   <description><![CDATA[<p>Firefighter Rivers died in the line of duty.</p>]]></description>
   <media:content url="https://www.firehero.org/wp-content/uploads/rivers.jpg" type="image/jpeg" />
   <enclosure url="https://www.firehero.org/wp-content/uploads/rivers-portrait.jpg" length="10" type="image/jpeg" />
  </item>
 </channel>
</rss>"""

ODMP = next(f for f in FEEDS if f["id"] == "odmp")
FIREHERO = next(f for f in FEEDS if f["id"] == "firehero")

print("\nparse_feed — odmp")
odmp = parse_feed(ODMP_XML)
check("every item parsed", len(odmp) == 3, f"got {len(odmp)}")
first = odmp[0]
check(
    "double CDATA + trailing text becomes a summary",
    first["summary"].startswith("Master Deputy Sheriff Jillian Olson was killed"),
    repr(first["summary"][:60]),
)
check("&apos; decoded", "Sheriff's Department" in first["summary"])
check("img tags kept out of the summary", "<img" not in first["summary"])
check("paragraph break survives", "\n\n" in first["summary"])
check("end_of_watch read", first["end_of_watch"] == "July 30, 2026")
check(
    "both images found, portrait first",
    first["images"]
    == [
        "https://www.odmp.org/media/thumb/50/officer/27881/c_olson_jillian.jpg",
        "https://www.odmp.org/media/thumb/50/agency/2140/lexington-county-sheriffs-department.png",
    ],
    str(first["images"]),
)

print("\nname_from_link")
check(
    "slug name confirmed against the summary",
    CuffMemorial.display_name(ODMP, first) == "Master Deputy Sheriff Jillian Olson",
    CuffMemorial.display_name(ODMP, first),
)
check(
    "second officer too",
    CuffMemorial.display_name(ODMP, odmp[1]) == "Town Marshal Brad Fisher",
    CuffMemorial.display_name(ODMP, odmp[1]),
)
check(
    "summary spelling wins over the slug",
    name_from_link(
        "https://www.odmp.org/officer/27000-officer-sean-o-brien",
        "Officer Sean O'Brien was shot and killed.",
    )
    == "Officer Sean O'Brien",
    name_from_link("https://www.odmp.org/officer/27000-officer-sean-o-brien", "Officer Sean O'Brien x"),
)
check(
    "no summary match falls back to the slug",
    name_from_link("https://www.odmp.org/officer/27000-deputy-lee-vance-jr", "unrelated text")
    == "Deputy Lee Vance Jr.",
    name_from_link("https://www.odmp.org/officer/27000-deputy-lee-vance-jr", "unrelated text"),
)
check("trailing slash slug", name_from_link("https://x.org/a/12-jane-doe/") == "Jane Doe")
check("query and anchor ignored", name_from_link("https://x.org/a/12-jane-doe?utm=1#top") == "Jane Doe")
check("no slug is no name", name_from_link("") is None)
check(
    "feed without name_from_link keeps its title",
    CuffMemorial.display_name(FIREHERO, {"title": "Firefighter Dana Rivers", "link": "https://x/y"})
    == "Firefighter Dana Rivers",
)

print("\nwhich image is the portrait")
check(
    "portrait picked and upgraded past the 50px thumb",
    CuffMemorial.photo_url(ODMP, first)
    == "https://www.odmp.org/media/thumb/400/officer/27881/c_olson_jillian.jpg",
    str(CuffMemorial.photo_url(ODMP, first)),
)
check(
    "agency badge picked separately",
    CuffMemorial.logo_url(ODMP, first)
    == "https://www.odmp.org/media/thumb/400/agency/2140/lexington-county-sheriffs-department.png",
    str(CuffMemorial.logo_url(ODMP, first)),
)
check(
    "one-image item has a portrait and no badge",
    CuffMemorial.photo_url(ODMP, odmp[1]) is not None
    and CuffMemorial.logo_url(ODMP, odmp[1]) is None,
)
check(
    "no images at all is not a crash",
    CuffMemorial.photo_url(ODMP, {"images": []}) is None,
)
k9 = next(i for i in odmp if "/k9/" in (i["link"] or ""))
check(
    "a K9 gets their photo too, filed under /k9/",
    CuffMemorial.photo_url(ODMP, k9)
    == "https://www.odmp.org/media/thumb/400/k9/1970/c_leonidas-2.jpg",
    str(CuffMemorial.photo_url(ODMP, k9)),
)
check("K9 name reads right", CuffMemorial.display_name(ODMP, k9) == "K9 Leonidas",
      CuffMemorial.display_name(ODMP, k9))
check(
    "US is an acronym, not a word",
    name_from_link("https://www.odmp.org/officer/27846-deputy-us-marshal-michael-hanson", "")
    == "Deputy US Marshal Michael Hanson",
    name_from_link("https://www.odmp.org/officer/27846-deputy-us-marshal-michael-hanson", ""),
)

print("\nparse_feed — firehero")
fh = parse_feed(FIREHERO_XML)
check("news item keeps its WordPress text but drops the trailer", "appeared first on" not in fh[0]["summary"])
check("news text itself survives", fh[0]["summary"].startswith("In 1964,"), repr(fh[0]["summary"][:40]))
check("video enclosure is not an image", fh[0]["images"] == [], str(fh[0]["images"]))
check("news is filtered out of the memorial feed", not item_matches_feed(FIREHERO["match"], fh[0]))
check("hero profile passes the filter", item_matches_feed(FIREHERO["match"], fh[1]))
check(
    "media:content and image enclosure both collected",
    fh[1]["images"]
    == [
        "https://www.firehero.org/wp-content/uploads/rivers.jpg",
        "https://www.firehero.org/wp-content/uploads/rivers-portrait.jpg",
    ],
    str(fh[1]["images"]),
)
check(
    "hintless feed takes the first image as the portrait",
    CuffMemorial.photo_url(FIREHERO, fh[1])
    == "https://www.firehero.org/wp-content/uploads/rivers.jpg",
)

print("\nthe embed")
cog = CuffMemorial.__new__(CuffMemorial)  # no bot, no Config — embed building only
embed = cog.memorial_embed(ODMP, first)
check("name is the title", embed.title == "🕯️ 🚓 Master Deputy Sheriff Jillian Olson", embed.title)
check("title links to the profile", embed.url == first["link"])
check("description is the story", embed.description.startswith("Master Deputy Sheriff Jillian Olson was"))
check("description stays within the cap", len(embed.description) <= SUMMARY_CHARS)
check("photo is the big image", embed.image.url.endswith("/thumb/400/officer/27881/c_olson_jillian.jpg"))
check("badge is the thumbnail", "/agency/" in (embed.thumbnail.url or ""))
fields = {f.name: f.value for f in embed.fields}
check("agency kept as a field", fields.get("Agency") == "Lexington County Sheriff's Department (SC)")
check("end of watch shown", fields.get("End of watch") == "July 30, 2026")
check("the line is still there", "gone, but not forgotten" in embed.footer.text)
check("pubDate becomes the timestamp", embed.timestamp is not None and embed.timestamp.year == 2026)

fh_embed = cog.memorial_embed(FIREHERO, fh[1])
check("firefighter keeps the feed title as name", fh_embed.title == "🕯️ 🚒 Firefighter Dana Rivers")
check("no agency field where <title> is the name", "Agency" not in {f.name for f in fh_embed.fields})

bare = cog.memorial_embed(ODMP, {"id": "x", "title": "(untitled)", "link": None, "images": []})
check("an item with nothing still builds", isinstance(bare.title, str) and bare.url is None)

print("\nthe feeds added on trial (usfa, iaff, cpof)")

USFA_XML = """<rss version="2.0"><channel><title>USFA Firefighter Fatality Notices</title>
<item><title>Jul 24, 2026: Nathan Matthews, Helitack Crewmember - Rifle, CO</title>
<pubDate>Sat, 01 Aug 2026 13:12:00 EDT</pubDate>
<link>https://apps.usfa.fema.gov/firefighter-fatalities/details?id=8715</link>
<guid>https://apps.usfa.fema.gov/firefighter-fatalities/details?id=8715</guid></item>
<item><title>Jul 11, 2026: Dan Hernandez Jr., Fire Safety Chief - Elkhart, TX</title>
<pubDate>Sat, 01 Aug 2026 13:12:00 EDT</pubDate>
<link>https://apps.usfa.fema.gov/firefighter-fatalities/details?id=8711</link>
<guid>https://apps.usfa.fema.gov/firefighter-fatalities/details?id=8711</guid></item>
</channel></rss>"""

IAFF_XML = """<rss version="2.0"><channel><title>IAFF - LODD</title>
<item><title>John D. Whitney</title>
<link>https://lodd.iaff.org/LODDProfile?ID=1050244</link>
<pubDate>Wed, 29 Jul 2026 07:49:23 +0000</pubDate>
<guid isPermaLink="false">https://lodd.iaff.org/LODDProfile?ID=1050244</guid>
<description><![CDATA[L2548, Greenfield, MA]]></description></item>
</channel></rss>"""

CPOF_XML = """<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Line of Duty Death</title>
<item><title>Remembering Sergeant Fredrick T. Coleman, Sr.: One Year Later</title>
<link>https://cpof.org/line-of-duty-death/remembering-sergeant-fredrick-t-coleman-sr-one-year-later/?utm_source=rss</link>
<pubDate>Mon, 20 Jul 2026 17:05:00 +0000</pubDate>
<guid isPermaLink="false">https://cpof.org/?p=11237</guid>
<description><![CDATA[<p>End of Watch: July 31, 2025 One year ago, Sergeant Fredrick T. Coleman, Sr. answered a call [&#8230;]</p>
The post <a href="https://cpof.org/x/">Remembering Sergeant Coleman</a> appeared first on <a href="https://cpof.org">Correctional Peace Officers Foundation</a>.]]></description>
<content:encoded><![CDATA[<p><strong>End of Watch: July 31, 2025</strong></p>
<p>One year ago, Sergeant Fredrick T. Coleman, Sr. answered a call for assistance from a fellow officer at the Cummins Unit in Arkansas.</p>]]></content:encoded></item>
</channel></rss>"""

USFA = next(f for f in FEEDS if f["id"] == "usfa")
IAFF = next(f for f in FEEDS if f["id"] == "iaff")
CPOF = next(f for f in FEEDS if f["id"] == "cpof")

usfa = parse_feed(USFA_XML)
usfa_embed = cog.memorial_embed(USFA, usfa[0])
usfa_fields = {f.name: f.value for f in usfa_embed.fields}
check(
    "usfa: the name is cut out of the title line",
    usfa_embed.title == "🕯️ 🇺🇸 Nathan Matthews",
    usfa_embed.title,
)
check("usfa: rank", usfa_fields.get("Rank") == "Helitack Crewmember", str(usfa_fields))
check("usfa: location", usfa_fields.get("Location") == "Rifle, CO")
check("usfa: end of watch", usfa_fields.get("End of watch") == "Jul 24, 2026")
check(
    "usfa: with no story of its own, the description is just the way in",
    usfa_embed.description
    == "[Read the full fatality notice →](<https://apps.usfa.fema.gov/firefighter-fatalities/details?id=8715>)",
    repr(usfa_embed.description),
)
check(
    "usfa: a name carrying a suffix survives the comma split",
    cog.display_name(USFA, usfa[1]) == "Dan Hernandez Jr.",
    cog.display_name(USFA, usfa[1]),
)
check(
    "usfa: a title that does not match is left alone",
    cog.display_name(USFA, {"title": "Feed maintenance notice"}) == "Feed maintenance notice",
)

iaff = parse_feed(IAFF_XML)
iaff_embed = cog.memorial_embed(IAFF, iaff[0])
iaff_fields = {f.name: f.value for f in iaff_embed.fields}
check("iaff: the title is already the name", iaff_embed.title == "🕯️ ⚒️ John D. Whitney")
check(
    "iaff: the local reads as a field, not as prose",
    iaff_fields.get("Local") == "L2548, Greenfield, MA"
    and iaff_embed.description.startswith("[View their line-of-duty-death profile →]"),
    str(iaff_fields),
)

cpof = parse_feed(CPOF_XML)
cpof_embed = cog.memorial_embed(CPOF, cpof[0])
cpof_fields = {f.name: f.value for f in cpof_embed.fields}
check(
    "cpof: the full article is preferred over the teaser",
    "[…]" not in (cpof_embed.description or "")
    and cpof_embed.description.startswith("One year ago, Sergeant Fredrick"),
    repr((cpof_embed.description or "")[:60]),
)
check("cpof: WordPress trailer dropped", "appeared first on" not in cpof_embed.description)
check(
    "cpof: end of watch lifted out of the opening line",
    cpof_fields.get("End of watch") == "July 31, 2025"
    and "End of Watch" not in cpof_embed.description,
    str(cpof_fields),
)
check(
    "cpof: the headline stays the title",
    cpof_embed.title.endswith("Remembering Sergeant Fredrick T. Coleman, Sr.: One Year Later"),
    cpof_embed.title,
)

CPOF_PAGE = """<html><head><meta property="og:image" content="https://cpof.org/wp-content/uploads/2023/02/CPOF_Logo-copy.png"></head>
<body style="background:url(https://cpof.org/wp-content/uploads/2022/10/heart-icon.png)">
<img src="https://cpof.org/wp-content/uploads/2026/07/coleman.jpg" width="200">
</body></html>"""
check(
    "cpof: the page portrait is found, the site furniture is not",
    CuffMemorial.pick_page_image(CPOF["page_image"], CPOF_PAGE)
    == "https://cpof.org/wp-content/uploads/2026/07/coleman.jpg",
    str(CuffMemorial.pick_page_image(CPOF["page_image"], CPOF_PAGE)),
)
check(
    "cpof: a page with only furniture yields no photo",
    CuffMemorial.pick_page_image(
        CPOF["page_image"],
        '<img src="https://cpof.org/wp-content/uploads/2021/12/cpof-logo-tp.png">',
    )
    is None,
)


def run_build_embed(feed, item, scraped=None):
    """build_embed with the page fetch stubbed out."""
    built = CuffMemorial.__new__(CuffMemorial)

    async def scrape_image(_feed, _item):
        return scraped

    built.scrape_image = scrape_image
    return asyncio.run(CuffMemorial.build_embed(built, feed, item))


check(
    "cpof: a scraped portrait lands as the embed image",
    run_build_embed(CPOF, cpof[0], "https://cpof.org/wp-content/uploads/2026/07/coleman.jpg").image.url
    == "https://cpof.org/wp-content/uploads/2026/07/coleman.jpg",
)
check(
    "cpof: no portrait found is still a valid embed",
    run_build_embed(CPOF, cpof[0], None).image.url is None,
)
check(
    "a feed that carries its own photo is never scraped",
    run_build_embed(ODMP, first, "https://example.invalid/wrong.jpg").image.url
    == "https://www.odmp.org/media/thumb/400/officer/27881/c_olson_jillian.jpg",
)
check(
    "every feed posts in the one memorial channel",
    {f.get("default_channel_id") for f in FEEDS} == {MEMORIAL_CHANNEL_ID},
    str([(f["id"], f.get("default_channel_id")) for f in FEEDS]),
)
check(
    "the ping role follows the kind of service, not the feed",
    [FEEDS_BY_ID[i]["role_id"] for i in ("odmp", "firehero", "usfa", "iaff", "cpof")]
    == [
        ROLE_FALLEN_POLICE,
        ROLE_FALLEN_FIREFIGHTER,
        ROLE_FALLEN_FIREFIGHTER,
        ROLE_FALLEN_FIREFIGHTER,
        ROLE_CORRECTIONAL_OFFICER,
    ],
    str([(i, FEEDS_BY_ID[i]["role_id"]) for i in FEEDS_BY_ID]),
)
check("every feed has a ping role", all(f["role_id"] for f in FEEDS))

print("\nsources that push back")
check(
    "the agent is Mozilla-shaped, or cpof.org answers 429 to everything",
    USER_AGENT.startswith("Mozilla/5.0"),
    USER_AGENT,
)
check("and it still says who is calling", "CuffBot" in USER_AGENT)


def run_fetch_text(feed, curl_body="<rss><channel></channel></rss>"):
    """fetch_text with both routes stubbed, to see which one it takes."""
    reader = CuffMemorial.__new__(CuffMemorial)
    used = []

    async def fake_curl(url):
        used.append(("curl", url))
        return curl_body

    async def fake_session():
        used.append(("aiohttp", feed["url"]))
        raise AssertionError("this feed should not have gone through aiohttp")

    reader.fetch_via_curl = fake_curl
    reader.session = fake_session
    body = asyncio.run(CuffMemorial.fetch_text(reader, feed))
    return body, used


body, used = run_fetch_text(IAFF)
check("iaff is read with curl, since Cloudflare refuses aiohttp", used == [("curl", IAFF["url"])], str(used))
check("and curl's output is what gets parsed", body.startswith("<rss>"))
missing_curl = CuffMemorial.__new__(CuffMemorial)


async def curl_gone(_url):
    return None


missing_curl.fetch_via_curl = curl_gone
check(
    "no curl output reads as unreachable, never as an empty feed",
    asyncio.run(CuffMemorial.fetch_text(missing_curl, IAFF)) is None,
)

USFA_RECORD = {
    "firstName": "David",
    "lastName": "Gagnon",
    "rank": "Chief",
    "age": 58,
    "serviceYrs": 1,
    "fdName": "Cottekill Volunteer Fire Company",
    "initialSummary": (
        '<p class="lead">Chief David Gagnon responded to a call for a tree down across a '
        "roadway and was struck by a portion of the tree when it snapped.</p>"
    ),
}
record = CuffMemorial.usfa_record(usfa[0], USFA_RECORD)
check(
    "usfa: the API record supplies the account the feed lacks",
    record["summary"].startswith("Chief David Gagnon responded to a call")
    and "<p" not in record["summary"],
    repr(record["summary"][:50]),
)
check(
    "usfa: department, age and years of service come along",
    record["extra_fields"]
    == [("Department", "Cottekill Volunteer Fire Company"), ("Age", "58"), ("Served", "1 year")],
    str(record["extra_fields"]),
)
check(
    "usfa: those land as fields on the embed, after rank and location",
    [f.name for f in cog.memorial_embed(USFA, record).fields]
    == ["Rank", "Location", "Department", "Age", "Served", "End of watch"],
    str([f.name for f in cog.memorial_embed(USFA, record).fields]),
)
check(
    "usfa: a record without the extras still builds",
    CuffMemorial.usfa_record(usfa[0], {})["extra_fields"] == [],
)


def run_enrich(feed, item):
    """enrich_from_api on a cog whose network would blow up if touched."""
    caller = CuffMemorial.__new__(CuffMemorial)

    async def session():
        raise AssertionError("a feed without an api rule must not call out")

    caller.session = session
    return asyncio.run(CuffMemorial.enrich_from_api(caller, feed, item))


check("a feed with no API rule is left exactly as it was", run_enrich(ODMP, first) is first)
check(
    "and neither is one whose link carries no record id",
    run_enrich(USFA, {"link": "https://apps.usfa.fema.gov/firefighter-fatalities/"})
    == {"link": "https://apps.usfa.fema.gov/firefighter-fatalities/"},
)

print("\nthe way to the full account")
long_story = {**first, "summary": "word " * 400}
long_embed = cog.memorial_embed(ODMP, long_story)
check(
    "a cut-off account ends with a link to the rest",
    long_embed.description.endswith(
        "[Read their full memorial →](<https://www.odmp.org/officer/27881-master-deputy-sheriff-jillian-olson>)"
    ),
    long_embed.description[-90:],
)
check("and says it was cut", "…" in long_embed.description)
check(
    "the story itself still fits the cap",
    len(long_embed.description.split("\n\n[")[0]) <= SUMMARY_CHARS,
)
check(
    "each feed asks for its own reading",
    [FEEDS_BY_ID[i].get("link_text") for i in ("odmp", "cpof", "usfa", "iaff", "firehero")]
    == [
        "Read their full memorial",
        "Read the full tribute",
        "Read the full fatality notice",
        "View their line-of-duty-death profile",
        "Read their full profile",
    ],
)
check(
    "a query string does not break the markdown link",
    "(<https://cpof.org/line-of-duty-death/remembering-sergeant-fredrick-t-coleman-sr-one-year-later/?utm_source=rss>)"
    in cog.memorial_embed(CPOF, cpof[0]).description,
    cpof_embed.description[-80:],
)
check(
    "an item without a link gets no dangling read-more",
    cog.memorial_embed(ODMP, {"summary": "text", "link": None}).description == "text",
)

print("\nthe test command")


class FakeCtx:
    """Just enough context to run the command body: send, typing, guild."""

    def __init__(self):
        self.sent = []
        self.guild = object()
        self.clean_prefix = "$"

    async def send(self, content=None, embed=None, **kwargs):
        self.sent.append({"content": content, "embed": embed, **kwargs})

    def typing(self):
        class _Typing:
            async def __aenter__(self_inner):
                return None

            async def __aexit__(self_inner, *exc):
                return False

        return _Typing()


class FakeConfig:
    """Guild config that is all defaults, and refuses to be written to."""

    def guild(self, _guild):
        class _Group:
            async def all(self_inner):
                return {"seen": {}}

            def seen(self_inner):
                raise AssertionError("the test command must not touch seen state")

            def posted(self_inner):
                raise AssertionError("the test command must not record posts")

        return _Group()


def run_test_command(feed_id=None, count=1, items_by_feed=None):
    cog = CuffMemorial.__new__(CuffMemorial)
    cog.config = FakeConfig()

    async def fetch_items(feed):
        return (items_by_feed or {}).get(feed["id"])

    cog.fetch_items = fetch_items
    ctx = FakeCtx()
    asyncio.run(CuffMemorial.memorial_test(cog, ctx, feed_id, count))
    return ctx


sent = run_test_command("odmp", 2, {"odmp": odmp}).sent
check("posts the asked-for number of entries", len(sent) == 2, f"got {len(sent)}")
check(
    "each post carries the real memorial embed",
    all(m["embed"] is not None for m in sent)
    and sent[0]["embed"].title == "🕯️ 🚓 Master Deputy Sheriff Jillian Olson",
)
check("newest first", sent[1]["embed"].title == "🕯️ 🚓 Town Marshal Brad Fisher")
check(
    "the ping role is named but not pinged",
    all("would ping" in (m["content"] or "") for m in sent)
    and all(
        m["allowed_mentions"].roles is False or m["allowed_mentions"].roles == []
        for m in sent
    ),
    str(sent[0]["content"]),
)
check("nothing pings anyone", all(m["allowed_mentions"].everyone is False for m in sent))

check(
    "count is capped",
    len(run_test_command("odmp", 99, {"odmp": odmp * 4}).sent) == MAX_MANUAL,
    str(len(run_test_command("odmp", 99, {"odmp": odmp * 4}).sent)),
)
ALL_ITEMS = {"odmp": odmp, "firehero": fh, "usfa": usfa, "iaff": iaff, "cpof": cpof}
check(
    "a bare number is a count, not a feed id",
    len(run_test_command("2", None, ALL_ITEMS).sent) == 7,
    "2 officers + 1 firefighter profile + 2 usfa + 1 iaff + 1 cpof",
)
check(
    "count below 1 still shows one",
    len(run_test_command("odmp", 0, {"odmp": odmp}).sent) == 1,
)
check(
    "an unknown feed id is refused, nothing posted",
    "Unknown feed" in (run_test_command("nope", 1, {}).sent[0]["embed"].title or ""),
)
unreachable = run_test_command("odmp", 1, {"odmp": None}).sent
check(
    "an unreachable feed says so instead of crashing",
    len(unreachable) == 1 and "Feed down" in unreachable[0]["embed"].title,
)
newsonly = run_test_command("firehero", 1, {"firehero": [fh[0]]}).sent
check(
    "a feed with only news says there is nothing to preview",
    len(newsonly) == 1 and "nothing to preview" in newsonly[0]["embed"].description,
)
both = run_test_command(None, 1, ALL_ITEMS).sent
check("no feed id covers every feed", len(both) == len(FEEDS), f"got {len(both)}")

print("\nthe backfill command")


class FakeGroup:
    """A guild config group backed by a plain dict, writes and all."""

    def __init__(self, store):
        self.store = store

    async def all(self):
        return {"seen": {}, "posted": {}, **self.store}

    def _writable(self, key):
        store = self.store.setdefault(key, {})

        class _Ctx:
            async def __aenter__(self_inner):
                return store

            async def __aexit__(self_inner, *exc):
                return False

        return _Ctx()

    def seen(self):
        return self._writable("seen")

    def posted(self):
        return self._writable("posted")


class StatefulConfig:
    def __init__(self, store):
        self.store = store

    def guild(self, _guild):
        return FakeGroup(self.store)


def fake_channel(can_send=True, breaks_after=None):
    """A channel real enough for isinstance() and for counting posts."""
    channel = MagicMock(spec=discord.TextChannel)
    channel.mention = "#fallen-heroes"
    channel.sent = []

    def permissions_for(_me):
        return SimpleNamespace(send_messages=can_send)

    async def send(content=None, embed=None, **kwargs):
        if breaks_after is not None and len(channel.sent) >= breaks_after:
            raise discord.HTTPException(SimpleNamespace(status=403, reason="no"), "nope")
        channel.sent.append({"content": content, "embed": embed, **kwargs})

    channel.permissions_for = permissions_for
    channel.send = send
    return channel


def run_backfill(feed_id=None, count=None, items=None, store=None, channel=None):
    cog = CuffMemorial.__new__(CuffMemorial)
    store = {"odmp_channel_id": 123, "seen": {}} if store is None else store
    cog.config = StatefulConfig(store)
    channel = fake_channel() if channel is None else channel

    async def fetch_items(feed):
        return items

    cog.fetch_items = fetch_items
    ctx = FakeCtx()
    ctx.guild = SimpleNamespace(get_channel=lambda _id: channel, me=object())
    asyncio.run(CuffMemorial.memorial_backfill(cog, ctx, feed_id, count))
    return channel, store, ctx


chan, store, ctx = run_backfill("odmp", 2, items=odmp)
check("posts the asked-for number in the real channel", len(chan.sent) == 2, str(len(chan.sent)))
check(
    "oldest first, so the channel reads in order",
    chan.sent[0]["embed"].title.endswith("Town Marshal Brad Fisher")
    and chan.sent[1]["embed"].title.endswith("Master Deputy Sheriff Jillian Olson"),
    chan.sent[0]["embed"].title,
)
check("no ping text at all", all(m["content"] is None for m in chan.sent))
check(
    "and nothing is mentionable either",
    all(m["allowed_mentions"].roles in (False, []) for m in chan.sent)
    and all(m["allowed_mentions"].everyone is False for m in chan.sent),
)
check("what was posted is marked seen", len(store["seen"]["odmp"]) >= 2)
check(
    "and separately recorded as really posted",
    len(store["posted"]["odmp"]) == 2,
    str(store["posted"]["odmp"]),
)
check(
    "an unbaselined feed's backlog is marked seen too, so no ping storm follows",
    set(store["seen"]["odmp"]) == {i["id"] for i in odmp},
    str(len(store["seen"]["odmp"])),
)
check(
    "the report says where and how many",
    "Posted **2**" in ctx.sent[-1]["embed"].fields[0].value
    and "#fallen-heroes" in ctx.sent[-1]["embed"].fields[0].value,
    ctx.sent[-1]["embed"].fields[0].value,
)

# Running it a second time on the same state must not double-post anyone.
chan2, store2, ctx2 = run_backfill("odmp", 2, items=odmp, store=store)
check("a second run posts nobody twice", len(chan2.sent) == 0)
check(
    "and says it skipped them",
    "Skipped **2**" in ctx2.sent[-1]["embed"].fields[0].value,
    ctx2.sent[-1]["embed"].fields[0].value,
)

# The case this command exists for: a feed baselined silently, so every entry
# counts as seen while the channel is still empty. Those must be posted.
baselined_empty = {"odmp_channel_id": 123, "seen": {"odmp": [i["id"] for i in odmp]}}
chanb, storeb, _ = run_backfill("odmp", 2, items=odmp, store=baselined_empty)
check(
    "baselined-but-never-posted entries are placed, not skipped",
    len(chanb.sent) == 2,
    f"{len(chanb.sent)} posted",
)
check("and are now on record as posted", len(storeb["posted"]["odmp"]) == 2)

# A feed that was already baselined keeps its remaining backlog for the sweep.
already = {"odmp_channel_id": 123, "seen": {"odmp": [odmp[2]["id"]]}}
chan3, store3, _ = run_backfill("odmp", 1, items=odmp, store=already)
check("baselined feed: posts the newest one", len(chan3.sent) == 1)
check(
    "and does not swallow the entries it did not post",
    set(store3["seen"]["odmp"]) == {odmp[2]["id"], odmp[0]["id"]},
    str(store3["seen"]["odmp"]),
)

_, store5, ctx5 = run_backfill(
    "odmp", 2, items=odmp, store={"odmp_channel_id": None, "seen": {}}
)
check(
    "no channel configured: nothing posted, nothing marked seen",
    "No channel" in ctx5.sent[-1]["embed"].fields[0].value and not store5["seen"],
    ctx5.sent[-1]["embed"].fields[0].value,
)
_, store6, ctx6 = run_backfill("odmp", 2, items=None)
check(
    "unreachable feed: nothing posted, nothing marked seen",
    "unreachable" in ctx6.sent[-1]["embed"].fields[0].value and not store6["seen"],
    ctx6.sent[-1]["embed"].fields[0].value,
)
_, store7, ctx7 = run_backfill("odmp", 2, items=odmp, channel=fake_channel(can_send=False))
check(
    "no permission: says so, marks nothing",
    "cannot post" in ctx7.sent[-1]["embed"].fields[0].value and not store7["seen"],
    ctx7.sent[-1]["embed"].fields[0].value,
)
chan8, store8, _ = run_backfill("odmp", 3, items=odmp, channel=fake_channel(breaks_after=1))
check(
    "a channel that breaks mid-run keeps what landed and stops",
    len(chan8.sent) == 1 and len(store8["seen"]["odmp"]) == 1,
    f"{len(chan8.sent)} posted, seen={store8['seen']['odmp']}",
)

print("\nshorten / strip_html")
check("short text untouched", shorten("hello", 700) == "hello")
check("long text cut on a word", shorten("aaa bbb ccc ddd", 12).endswith("…") and " " in shorten("aaa bbb ccc ddd", 12))
check("cut stays within the limit", len(shorten("x" * 900, 700)) <= 700)
check("tags become text", strip_html("<p>a<br/>b</p>") == "a\n\nb", repr(strip_html("<p>a<br/>b</p>")))
check(
    "paragraphs separated only by markup still read as paragraphs",
    strip_html("<p>One.</p><p>Two.</p>") == "One.\n\nTwo.",
    repr(strip_html("<p>One.</p><p>Two.</p>")),
)
check("no runaway blank lines", "\n\n\n" not in strip_html("<p>a</p><br/><br/><p>b</p>"))

print()
if failures:
    print(f"{len(failures)} FAILED: " + ", ".join(failures))
    sys.exit(1)
print("all memorial checks passed")
