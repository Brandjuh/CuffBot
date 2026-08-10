"""cufffallen pure helpers + cog shape.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_fallen.py

Config is pointed at a throwaway directory before the cog is imported, so the
live submission queue is never touched.
"""

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(tempfile.mkdtemp(prefix="cufffallen-test-"))

from redbot.core import data_manager

data_manager.basic_config = {
    "DATA_PATH": str(DATA),
    "CORE_PATH_APPEND": "core",
    "COG_PATH_APPEND": "cogs",
    "STORAGE_TYPE": "JSON",
    "STORAGE_DETAILS": {},
}

import discord

from cufffallen.submission import (
    AGENCIES,
    AGENCY_ORDER,
    DESCRIPTION_LIMIT,
    MAX_NAME,
    MAX_TEXT,
    TITLE_LIMIT,
    agency_for,
    build_description,
    clean_url,
    clip,
    looks_like_image,
    memorial_embed,
    parse_agency,
    role_id_for,
)
from cufffallen.views import PANEL_BUTTON_ID, REVIEW_PREFIX

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


print("agencies")
check("four of them", tuple(AGENCIES) and set(AGENCY_ORDER) == set(AGENCIES))
check("police pings the memorial role", AGENCIES["police"].role_id == 627946543273738240)
check("fire pings the firefighter role", AGENCIES["fire"].role_id == 627946690024046675)
check("correctional pings its own role", AGENCIES["correctional"].role_id == 1533202959624830976)
check("ambulance has no role on purpose", AGENCIES["ambulance"].role_id is None)

print("parse_agency")
check("exact key", parse_agency("fire") == "fire")
check("label casing", parse_agency("Police") == "police")
check("alias ems", parse_agency("EMS") == "ambulance")
check("alias paramedic", parse_agency("paramedic") == "ambulance")
check("phrase fire department", parse_agency("fire department") == "fire")
check("phrase correctional officer", parse_agency("Correctional Officer") == "correctional")
check("hyphenated", parse_agency("law-enforcement/police") == "police")
check("nonsense", parse_agency("navy") is None)
check("empty", parse_agency("") is None)
check("none", parse_agency(None) is None)
check("agency_for falls back", agency_for("navy").key == "police")

print("role_id_for")
check("default", role_id_for("fire") == 627946690024046675)
check("override wins", role_id_for("fire", {"fire": 42}) == 42)
check("string override", role_id_for("fire", {"fire": "42"}) == 42)
check("zero means never ping", role_id_for("fire", {"fire": 0}) is None)
check("untouched agency keeps default", role_id_for("police", {"fire": 0}) == 627946543273738240)
check("ambulance stays silent", role_id_for("ambulance") is None)
check("ambulance can be given a role", role_id_for("ambulance", {"ambulance": 7}) == 7)

print("clean_url")
check("plain https", clean_url("https://odmp.org/officer/1") == "https://odmp.org/officer/1")
check("angle brackets stripped", clean_url("<https://odmp.org/x>") == "https://odmp.org/x")
check("whitespace trimmed", clean_url("  https://odmp.org/x  ") == "https://odmp.org/x")
check("http allowed", clean_url("http://odmp.org/x") == "http://odmp.org/x")
check("no scheme", clean_url("odmp.org/x") is None)
check("ftp refused", clean_url("ftp://odmp.org/x") is None)
check("two links glued", clean_url("https://a.org/x https://b.org/y") is None)
check("hostless", clean_url("https://x") is None)
check("empty", clean_url("") is None)
check("none", clean_url(None) is None)
check("over the length cap", clean_url("https://a.org/" + "x" * 500) is None)

print("looks_like_image")
check("jpg", looks_like_image("https://a.org/p.jpg"))
check("png with query", looks_like_image("https://a.org/p.png?size=2"))
check("webp", looks_like_image("https://a.org/p.webp"))
check("article page", not looks_like_image("https://a.org/officer/1"))
check("none", not looks_like_image(None))

print("clip / build_description")
check("short text untouched", clip("hello", 10) == "hello")
check("long text is cut", len(clip("x" * 50, 10)) == 10)
check("cut text is marked", clip("x" * 50, 10).endswith("…"))
desc = build_description("Their story.", "https://a.org/x")
check("story kept", desc.startswith("Their story."))
check("source linked", "https://a.org/x" in desc and "](<" in desc)
check("no source, no link line", build_description("Just text.", None) == "Just text.")
check(
    "a maximum-length story still fits the embed",
    len(build_description("x" * MAX_TEXT, "https://a.org/" + "y" * 300)) <= DESCRIPTION_LIMIT,
)

print("memorial_embed")
sub = {
    "name": "Firefighter John Doe",
    "agency": "fire",
    "source": "https://firehero.org/x",
    "text": "He went in.",
    "photo": "https://firehero.org/p.jpg",
}
embed = memorial_embed(sub)
check("title carries the name", "Firefighter John Doe" in embed.title)
check("title carries the agency emoji", "🚒" in embed.title)
check("clickable title", embed.url == "https://firehero.org/x")
check("photo becomes the image", embed.image.url == "https://firehero.org/p.jpg")
check("agency field", embed.fields[0].name == "Agency" and embed.fields[0].value == "Fire")
check("footer without credit", embed.footer.text == "Gone, but not forgotten.")
check("live colour", embed.color.value == 0x2C3E50)

credited = memorial_embed(sub, credit="Brand")
check("credit lands in the footer", "Submitted by Brand" in credited.footer.text)

tested = memorial_embed(sub, test=True)
check("test posts are marked", tested.footer.text.startswith("TEST POST"))
check("test posts change colour", tested.color.value != 0x2C3E50)

# The preview renders a half-finished draft, so a link that is not a link must
# be left out rather than handed to Discord, which rejects the whole embed.
broken = memorial_embed({**sub, "source": "odmp.org/x", "photo": "not a url"})
check("an unusable source link is dropped, not sent", broken.url is None)
check("an unusable photo link is dropped, not sent", broken.image.url is None)
check("the story survives a broken link", "He went in." in broken.description)
check("no dangling link line", "](<" not in broken.description)

huge = memorial_embed(
    {
        "name": "N" * 400,
        "agency": "ambulance",
        "source": "https://a.org/x",
        "text": "t" * 9000,
        "photo": "",
    }
)
check("over-long name is clipped to the title limit", len(huge.title) <= TITLE_LIMIT)
check("over-long story is clipped to the description limit", len(huge.description) <= DESCRIPTION_LIMIT)
check("no photo, no image", huge.image.url is None)
check("ambulance emoji", "🚑" in huge.title)

print("custom ids")
check("panel id is stable", PANEL_BUTTON_ID == "cufffallen:panel:submit")
check("review ids are addressable", REVIEW_PREFIX == "cufffallen:review:")

print("cog shape")


class _StubBot:
    def __init__(self):
        self.guilds = []
        self.added = []

    def add_view(self, view, **kwargs):
        self.added.append((view, kwargs))

    async def is_owner(self, user):
        return False

    async def is_admin(self, member):
        return False


from cufffallen.cufffallen import (  # noqa: E402
    PANEL_CHANNEL_ID,
    PUBLISH_CHANNEL_ID,
    REVIEW_CHANNEL_ID,
    TEST_CHANNEL_ID,
    CuffFallen,
)

check("panel channel is server information", PANEL_CHANNEL_ID == 670776730570719232)
check("publishes to fallen heroes", PUBLISH_CHANNEL_ID == 451095508560379934)
check("reviews in the admin channel", REVIEW_CHANNEL_ID == 411637334778576896)
check("test channel", TEST_CHANNEL_ID == 412334189879230474)

cog = CuffFallen(_StubBot())
names = {c.qualified_name for c in cog.walk_commands()}
for expected in (
    "fallenhero panel",
    "fallenhero test",
    "fallenhero testping",
    "fallenhero channel",
    "fallenhero role",
    "fallenhero credit",
    "fallenhero pending",
    "fallenhero show",
    "fallenhero cancel",
    "fallenhero settings",
):
    check(f"command {expected}", expected in names)

print("problems()")
good = {
    "name": "John Doe",
    "agency": "police",
    "source": "https://odmp.org/x",
    "text": "Their story.",
    "photo": "",
}
check("a complete draft is submittable", cog.problems(good) == [])
check("no name", any("name is empty" in p for p in cog.problems({**good, "name": " "})))
check("no text", any("message is empty" in p for p in cog.problems({**good, "text": ""})))
check("no agency", any("agency" in p for p in cog.problems({**good, "agency": None})))
check("bad source", any("source link" in p for p in cog.problems({**good, "source": "odmp.org"})))
check("bad photo", any("photo link" in p for p in cog.problems({**good, "photo": "nope"})))
check("empty photo is fine", cog.problems({**good, "photo": ""}) == [])
check("good photo is fine", cog.problems({**good, "photo": "https://a.org/p.jpg"}) == [])

note = cog.preview_note({**good, "photo": "https://a.org/officer/1"})
check("a non-image photo link is called out", "not an image" in note or "page, not an image" in note)
check("a blocked draft says so", "cannot be sent" in cog.preview_note({**good, "source": "x"}))

print("views")
from cufffallen.views import PreviewView, ReviewView  # noqa: E402

preview = PreviewView(cog, good)
check("preview has a disablable submit button", isinstance(preview.send, discord.ui.Button))
review = ReviewView(cog, "7")
ids = {item.custom_id for item in review.children}
check(
    "review buttons address the submission",
    ids == {"cufffallen:review:7:approve", "cufffallen:review:7:edit", "cufffallen:review:7:deny"},
    str(ids),
)
check("review view never times out", review.timeout is None)

# Discord rejects an over-long modal title, label or placeholder at send time,
# which is exactly where it would be invisible until a member pressed the
# button. Every modal is built here from a full draft and measured instead.
from cufffallen.views import AdminEditModal, DenyModal, DetailsModal  # noqa: E402

full = {**good, "photo": "https://a.org/p.jpg"}
for modal in (DetailsModal(cog, full), AdminEditModal(cog, "7", full), DenyModal(cog, "7")):
    label = type(modal).__name__
    check(f"{label} title fits", len(modal.title) <= 45, modal.title)
    check(f"{label} fits in one modal", len(modal.children) <= 5)
    for item in modal.children:
        check(f"{label} label fits: {item.label}", len(item.label) <= 45)
        check(
            f"{label} placeholder fits: {item.label}",
            not item.placeholder or len(item.placeholder) <= 100,
        )
        check(
            f"{label} prefill fits: {item.label}",
            not item.default or len(item.default) <= (item.max_length or 4000),
        )

details = DetailsModal(cog, full)
check("the modal prefills what was typed before", details.name_field.default == "John Doe")
check("the agency is not a modal field", len(details.children) == 4)
check(
    "the modal names the agency already picked",
    "Police" in details.title,
    details.title,
)

shutil.rmtree(DATA, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED: " + ", ".join(failures))
    sys.exit(1)
print("all good")
