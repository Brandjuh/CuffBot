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
    eow_ambiguous,
    eow_problem,
    format_eow,
    looks_like_image,
    memorial_embed,
    parse_agency,
    parse_eow,
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
check("over the length cap", clean_url("https://a.org/" + "x" * 1600) is None)
# The link that started all of this must survive cleaning: ~600 characters of
# fbcdn signing tokens is a link members really paste.
check(
    "a real fbcdn link fits",
    clean_url("https://scontent-fra5-2.xx.fbcdn.net/v/t39.99422-6/768350885_n.png?" + "&".join(f"tok{i}=AdqaMGSrP6fCi3h32xnkRwrgX1bCwl5j6CH7KJ4idusY" for i in range(12)))
    is not None,
)

print("looks_like_image")
check("jpg", looks_like_image("https://a.org/p.jpg"))
check("png with query", looks_like_image("https://a.org/p.png?size=2"))
check("webp", looks_like_image("https://a.org/p.webp"))
check("article page", not looks_like_image("https://a.org/officer/1"))
check("none", not looks_like_image(None))

print("parse_eow / format_eow")
check("iso", parse_eow("2026-08-03") == "2026-08-03")
check("iso with slashes", parse_eow("2026/8/3") == "2026-08-03")
check("iso with dots", parse_eow("2026.08.03") == "2026-08-03")
check("day first, unambiguous", parse_eow("23/8/2026") == "2026-08-23")
check("month first, unambiguous", parse_eow("8/23/2026") == "2026-08-23")
check("same number twice is safe", parse_eow("3/3/2026") == "2026-03-03")
check("ambiguous numeric is refused", parse_eow("3/8/2026") is None)
check("and named as ambiguous", eow_ambiguous("3/8/2026"))
check("iso is never ambiguous", not eow_ambiguous("2026-08-03"))
check("month written out", parse_eow("August 3, 2026") == "2026-08-03")
check("month abbreviated", parse_eow("aug 3 2026") == "2026-08-03")
check("day before month", parse_eow("3 August 2026") == "2026-08-03")
check("ordinal suffix", parse_eow("August 3rd, 2026") == "2026-08-03")
check("september's four-letter habit", parse_eow("sept 3 2026") == "2026-09-03")
check("stray spacing", parse_eow("  3   august   2026 ") == "2026-08-03")
check("not a date", parse_eow("last tuesday") is None)
check("not a real day", parse_eow("2026-02-30") is None)
check("thirteenth month", parse_eow("2026-13-01") is None)
check("prehistoric typo", parse_eow("226-08-03") is None)
check("empty", parse_eow("") is None)
check("none", parse_eow(None) is None)
check(
    "formatted the way ODMP writes one",
    format_eow("2026-08-03") == "Monday, August 3, 2026",
    str(format_eow("2026-08-03")),
)
check("format of nonsense is None", format_eow("nope") is None)

check("no date, no problem", eow_problem("") is None and eow_problem(None) is None)
check("a good date, no problem", eow_problem("2026-08-03") is None)
check("ambiguity is called out by name", "two ways" in eow_problem("3/8/2026"))
check("nonsense gets the format hint", "YYYY-MM-DD" in eow_problem("someday"))
check("the future is refused", "future" in eow_problem("2030-01-01"))
check("yesterday's heroes are not", eow_problem("1791-05-17") is None)

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

dated = memorial_embed({**sub, "eow": "2026-08-03"})
check(
    "an End of watch becomes the cuffmemorial field",
    any(f.name == "End of watch" and f.value == "Monday, August 3, 2026" for f in dated.fields),
)
check("no date, no field", not any(f.name == "End of watch" for f in embed.fields))

mirrored = memorial_embed(sub, photo_ref="attachment://fallen-hero.jpg")
check(
    "a mirrored photo beats the hotlink",
    mirrored.image.url == "attachment://fallen-hero.jpg",
)

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

print("photo mirroring (photo.py)")
import asyncio  # noqa: E402

from cufffallen.photo import (  # noqa: E402
    CONTENT_TYPES,
    MAX_PHOTO_BYTES,
    Photo,
    describe_size,
    fetch_photo,
    looks_expiring,
)

# The link that prompted the mirror: fbcdn, .png path, serves image/jpeg,
# signed with oh= and an oe= hex expiry four days out.
FBCDN = (
    "https://scontent-fra5-2.xx.fbcdn.net/v/t39.99422-6/768350885_n.png"
    "?stp=dst-jpg_tt6&oh=00_AQES&oe=6A7FCE48"
)
check("fbcdn is expiring", looks_expiring(FBCDN))
check("discord cdn is expiring", looks_expiring("https://cdn.discordapp.com/attachments/1/2/x.png?ex=66&is=66&hm=aa"))
check("s3 presigned is expiring", looks_expiring("https://x.s3.amazonaws.com/p.jpg?X-Amz-Expires=300"))
check("odmp is not", not looks_expiring("https://www.odmp.org/media/image/officer.jpg"))
check("none is not", not looks_expiring(None))

check("jpeg maps to jpg", CONTENT_TYPES["image/jpeg"] == "jpg")
check("svg is deliberately absent", "image/svg+xml" not in CONTENT_TYPES)
check("sizes read like sizes", describe_size(206934) == "202 KB", describe_size(206934))
check("big sizes in MB", describe_size(9 * 1024 * 1024) == "9.0 MB")

photo_obj = Photo(data=b"xx", filename="fallen-hero.jpg", content_type="image/jpeg")
check("the embed reference", photo_obj.reference == "attachment://fallen-hero.jpg")
check("a fresh File every send", photo_obj.as_file() is not photo_obj.as_file())


class FakeContent:
    def __init__(self, chunks):
        self.chunks = chunks

    async def iter_chunked(self, size):
        for chunk in self.chunks:
            yield chunk


class FakeResponse:
    def __init__(self, status=200, content_type="image/jpeg", body=b"J" * 100, length=None):
        self.status = status
        self.headers = {"Content-Type": content_type}
        if length is not None:
            self.headers["Content-Length"] = str(length)
        self.content = FakeContent([body[i : i + 10] for i in range(0, len(body), 10)])

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    def __init__(self, response):
        self.response = response

    def get(self, url, **kwargs):
        return self.response


def fetch(response, **kwargs):
    return asyncio.run(fetch_photo(FakeSession(response), FBCDN, **kwargs))

good_photo, why = fetch(FakeResponse())
check("a good download becomes a Photo", good_photo is not None and why is None)
check(
    "the content type names the file, not the URL's .png lie",
    good_photo.filename == "fallen-hero.jpg",
    good_photo.filename,
)
check("the bytes are all there", len(good_photo.data) == 100)

nothing, why = fetch(FakeResponse(status=403))
check("a refusal says the status", nothing is None and "403" in why)
nothing, why = fetch(FakeResponse(content_type="text/html"))
check("an article page is named for what it is", nothing is None and "page" in why)
nothing, why = fetch(FakeResponse(length=MAX_PHOTO_BYTES + 1))
check("a declared giant is refused before downloading", nothing is None and "limit" in why)
nothing, why = fetch(FakeResponse(body=b"J" * 200), limit=150)
check("a lying Content-Length is caught mid-stream", nothing is None and "limit" in why)
nothing, why = fetch(FakeResponse(body=b""))
check("an empty file is refused", nothing is None and "empty" in why)
nothing, why = asyncio.run(fetch_photo(FakeSession(FakeResponse()), ""))
check("no url, no fetch, no reason", nothing is None and why is None)

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
check("good date is fine", cog.problems({**good, "eow": "August 3, 2026"}) == [])
check("ambiguous date blocks", any("two ways" in p for p in cog.problems({**good, "eow": "3/8/2026"})))
check("future date blocks", any("future" in p for p in cog.problems({**good, "eow": "2031-01-01"})))

note = cog.preview_note({**good, "photo": "https://a.org/officer/1"})
check("a non-image photo link is called out", "not an image" in note or "page, not an image" in note)
check("a blocked draft says so", "cannot be sent" in cog.preview_note({**good, "source": "x"}))

print("views")
from cufffallen.views import PreviewView, ReviewView  # noqa: E402

preview = PreviewView(cog, good)
check("preview has a disablable submit button", isinstance(preview.send, discord.ui.Button))
review = ReviewView(cog, "7", "fire")
ids = {item.custom_id for item in review.children}
check(
    "review controls address the submission",
    ids
    == {
        "cufffallen:review:7:agencypick",
        "cufffallen:review:7:approve",
        "cufffallen:review:7:edit",
        "cufffallen:review:7:deny",
    },
    str(ids),
)
check("review view never times out", review.timeout is None)
picker = next(i for i in review.children if isinstance(i, discord.ui.Select))
check(
    "the picker marks the current agency",
    [o.value for o in picker.options if o.default] == ["fire"],
)
check("the picker sits above the buttons", picker.row == 0)

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
check("five fields — a modal's maximum, with End of watch in", len(details.children) == 5)
check("End of watch is one of them", details.eow_field.label.startswith("End of watch"))
check("and it is optional", details.eow_field.required is False)
check(
    "the modal names the agency already picked",
    "Police" in details.title,
    details.title,
)
admin_modal = AdminEditModal(cog, "7", full)
check(
    "the admin modal has no agency field — the review dropdown owns it",
    all("agency" not in (i.label or "").lower() for i in admin_modal.children),
)
check(
    "but it can fix the End of watch",
    any((i.label or "").startswith("End of watch") for i in admin_modal.children),
)

shutil.rmtree(DATA, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED: " + ", ".join(failures))
    sys.exit(1)
print("all good")
