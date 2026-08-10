"""cufffallen end to end on real Config: panel press → published memorial.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_fallen_flow.py

Discord is stubbed, Config is real and pointed at a throwaway directory. What
this is here for is the half of the cog no unit test reaches: which interaction
gets answered how, what actually lands in which channel, and whether a ping
goes out — the things that are only visibly wrong once a member has pressed
the button in front of the guild.
"""

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(tempfile.mkdtemp(prefix="cufffallen-flow-"))

from redbot.core import data_manager

data_manager.basic_config = {
    "DATA_PATH": str(DATA),
    "CORE_PATH_APPEND": "core",
    "COG_PATH_APPEND": "cogs",
    "STORAGE_TYPE": "JSON",
    "STORAGE_DETAILS": {},
}

import discord

from cufffallen.cufffallen import (
    PUBLISH_CHANNEL_ID,
    REVIEW_CHANNEL_ID,
    TEST_CHANNEL_ID,
    CuffFallen,
)

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


# ----------------------------------------------------------------------
# Stubs
# ----------------------------------------------------------------------


class FakeAttachment:
    """What a discord.File turns into once it is on a message."""

    def __init__(self, file):
        self.filename = file.filename
        self._data = file.fp.read()

    async def read(self):
        return self._data


class FakeMessage:
    def __init__(self, channel, message_id, attachments=()):
        self.id = message_id
        self.channel = channel
        self.attachments = list(attachments)
        self.edits = []

    @property
    def jump_url(self):
        return f"https://discord.com/channels/1/{self.channel.id}/{self.id}"

    async def edit(self, **kwargs):
        self.edits.append(kwargs)


class FakeChannel(discord.TextChannel):
    """A real TextChannel subclass — the cog refuses to post anywhere else."""

    def __init__(self, channel_id):
        self.id = channel_id
        self.sent = []
        self.messages = {}
        self._next = 9000

    @property
    def mention(self):
        return f"<#{self.id}>"

    async def send(self, content=None, **kwargs):
        self._next += 1
        attachments = [FakeAttachment(f) for f in kwargs.get("files") or []]
        message = FakeMessage(self, self._next, attachments)
        self.messages[message.id] = message
        self.sent.append({"content": content, **kwargs})
        return message

    async def fetch_message(self, message_id):
        found = self.messages.get(message_id)
        return found if found is not None else FakeMessage(self, message_id)


class FakeRole:
    def __init__(self, role_id):
        self.id = role_id

    @property
    def mention(self):
        return f"<@&{self.id}>"


class FakeMember(discord.Member):
    """A real Member subclass — ``is_admin`` will not read permissions off
    anything else, because a User in a DM has none to read."""

    def __init__(self, user_id, name="Brand", admin=False):
        self._id = user_id
        self._display = name
        self._admin = admin
        self.dms = []

    @property
    def id(self):
        return self._id

    @property
    def display_name(self):
        return self._display

    @property
    def guild_permissions(self):
        return discord.Permissions(administrator=self._admin, manage_guild=self._admin)

    def __str__(self):
        return f"{self._display}#0001"

    async def send(self, **kwargs):
        self.dms.append(kwargs)


class FakeGuild:
    id = 411157175948541954
    name = "Cuffbot"

    def __init__(self, channels, members):
        self._channels = {c.id: c for c in channels}
        self._members = {m.id: m for m in members}

    def get_channel(self, channel_id):
        return self._channels.get(channel_id)

    def get_member(self, user_id):
        return self._members.get(user_id)

    def get_role(self, role_id):
        return FakeRole(role_id)


class FakeResponse:
    """Records how an interaction was answered, and refuses to answer twice."""

    def __init__(self, interaction):
        self.interaction = interaction
        self.done = False
        self.kind = None
        self.payload = None
        self.modal = None

    def is_done(self):
        return self.done

    def _mark(self, kind, payload):
        if self.done:
            raise discord.InteractionResponded(self.interaction)
        self.done = True
        self.kind = kind
        self.payload = payload

    async def send_message(self, content=None, **kwargs):
        self._mark("send_message", {"content": content, **kwargs})

    async def edit_message(self, **kwargs):
        self._mark("edit_message", kwargs)

    async def send_modal(self, modal):
        self._mark("send_modal", {})
        self.modal = modal

    async def defer(self, **kwargs):
        self._mark("defer", {})


class FakeFollowup:
    def __init__(self):
        self.sent = []

    async def send(self, content=None, **kwargs):
        self.sent.append({"content": content, **kwargs})


class FakeInteraction:
    def __init__(self, guild, user):
        self.guild = guild
        self.user = user
        self.response = FakeResponse(self)
        self.followup = FakeFollowup()
        self.edits = []

    async def edit_original_response(self, **kwargs):
        self.edits.append(kwargs)


class FakeBot:
    def __init__(self, guild, owner_id):
        self.guilds = [guild]
        self.views = []
        self._owner = owner_id

    def add_view(self, view, **kwargs):
        self.views.append((view, kwargs))

    async def is_owner(self, user):
        return getattr(user, "id", None) == self._owner

    async def is_admin(self, member):
        return False


DRAFT = {
    "name": "Firefighter John Doe",
    "agency": "fire",
    "source": "https://firehero.org/x",
    "text": "He went in.",
    "photo": "https://firehero.org/p.jpg",
}

# The photo mirror, without the network: fetch_photo is swapped for this in
# the cog's module. Set ``NEXT_PHOTO`` to steer the outcome.
from cufffallen.photo import Photo  # noqa: E402

import cufffallen.cufffallen as cog_module  # noqa: E402

NEXT_PHOTO = {"photo": Photo(b"JPEGBYTES", "fallen-hero.jpg", "image/jpeg"), "why": None}
FETCHES = []


async def fake_fetch_photo(session, url, **kwargs):
    FETCHES.append(url)
    return NEXT_PHOTO["photo"], NEXT_PHOTO["why"]


cog_module.fetch_photo = fake_fetch_photo


async def main():
    review = FakeChannel(REVIEW_CHANNEL_ID)
    publish = FakeChannel(PUBLISH_CHANNEL_ID)
    test_channel = FakeChannel(TEST_CHANNEL_ID)
    member = FakeMember(700, "Brand")
    admin = FakeMember(701, "Chief", admin=True)
    guild = FakeGuild([review, publish, test_channel], [member, admin])
    bot = FakeBot(guild, owner_id=999)
    cog = CuffFallen(bot)
    # A stand-in session, so the stubbed fetch never touches aiohttp.
    cog._session = type("FakeSession", (), {"closed": False})()
    await cog.cog_load()

    print("cog_load")
    check("panel view is re-registered", len(bot.views) == 1)
    check("panel view never times out", bot.views[0][0].timeout is None)

    print("writing a submission")
    press = FakeInteraction(guild, member)
    await cog.start_submission(press)
    check("the panel answers privately", press.response.payload.get("ephemeral") is True)
    check("it starts on the agency question", press.response.kind == "send_message")

    draft = cog._drafts[(guild.id, member.id)]
    pick = FakeInteraction(guild, member)
    await cog.agency_chosen(pick, draft, "fire", then="modal")
    check("picking an agency opens the modal", pick.response.kind == "send_modal")
    check("the pick is remembered", draft["agency"] == "fire")

    typed = FakeInteraction(guild, member)
    await cog.details_submitted(
        typed,
        draft,
        name=DRAFT["name"],
        source=DRAFT["source"],
        text=DRAFT["text"],
        photo=DRAFT["photo"],
    )
    check("the modal defers while the photo downloads", typed.response.kind == "defer")
    check("the photo was fetched once", FETCHES == [DRAFT["photo"]])
    preview = typed.edits[-1]
    preview_embed = preview["embed"]
    check("the preview is the memorial", "Firefighter John Doe" in preview_embed.title)
    check("the preview can be sent", preview["view"].send.disabled is False)
    check("the photo is mirrored into the draft", draft["_photo"] is not None)
    check(
        "the preview shows the mirrored copy, not the link",
        preview_embed.image.url == "attachment://fallen-hero.jpg",
    )
    check(
        "the mirrored file rides on the preview message",
        len(preview["attachments"]) == 1,
    )
    check("and the note says it is safe", "uploaded with the" in preview["content"])

    print("a draft that is not ready")
    bad = dict(draft, source="firehero.org")
    blocked = FakeInteraction(guild, member)
    await cog.show_preview(blocked, bad)
    check("submit is disabled", blocked.response.payload["view"].send.disabled is True)
    check("and it says why", "source link" in blocked.response.payload["content"])
    check(
        "the broken link never reaches Discord",
        blocked.response.payload["embed"].url is None,
    )

    print("sending it to the admins")
    sent = FakeInteraction(guild, member)
    await cog.submit_for_approval(sent, draft)
    check("the button is deferred, not left hanging", sent.response.kind == "defer")
    check("exactly one review post", len(review.sent) == 1)
    check("nothing published yet", publish.sent == [])
    check("nothing in the test channel", test_channel.sent == [])
    check("the review post carries both embeds", len(review.sent[0]["embeds"]) == 2)
    check("the review post cannot ping", review.sent[0]["allowed_mentions"].roles is False)
    check("it has the three buttons", len(review.sent[0]["view"].children) == 3)
    check("the mirrored photo is on the review post", len(review.sent[0]["files"]) == 1)
    check(
        "whose embed shows the copy, not the link",
        review.sent[0]["embeds"][0].image.url == "attachment://fallen-hero.jpg",
    )
    check("the member is told", "Sent to the admins" in sent.edits[-1]["content"])
    check("the draft is cleared", (guild.id, member.id) not in cog._drafts)

    subs = await cog.config.guild(guild).submissions()
    check("one submission on file", list(subs) == ["1"])
    stored = subs["1"]
    check("stored as pending", stored["status"] == "pending")
    check("stored against the member", stored["user_id"] == member.id)
    check("stored as live, not test", stored["test"] is False)
    check("stored as mirrored", stored["photo_mirrored"] is True)
    check("under its attachment name", stored["photo_filename"] == "fallen-hero.jpg")
    check("no photo bytes in config", "_photo" not in stored)
    check("the review message id is kept", isinstance(stored["review_message_id"], int))
    check("review view re-registered for restarts", f"{guild.id}:1" in cog._registered)

    print("a second submission from the same member")
    draft2 = dict(DRAFT, name="Officer Jane Roe", agency="ambulance")
    sent2 = FakeInteraction(guild, member)
    await cog.submit_for_approval(sent2, draft2)
    subs = await cog.config.guild(guild).submissions()
    check("numbers do not collide", sorted(subs) == ["1", "2"])

    print("the queue is not bottomless")
    await cog.config.guild(guild).max_pending.set(2)
    third = FakeInteraction(guild, member)
    await cog.start_submission(third)
    check(
        "a member over the limit is turned away",
        "waiting on the admins" in third.response.payload["content"],
    )
    await cog.config.guild(guild).max_pending.set(3)

    print("only admins decide")
    nosy = FakeInteraction(guild, member)
    await cog.handle_review_action(nosy, "1", "approve")
    check("a member cannot approve", "Only the admins" in nosy.response.payload["content"])
    check("and nothing was published", publish.sent == [])

    print("an admin edits before approving")
    editing = FakeInteraction(guild, admin)
    await cog.handle_review_action(editing, "1", "edit")
    check("edit opens the modal", editing.response.kind == "send_modal")

    fixed = FakeInteraction(guild, admin)
    await cog.admin_edit_submitted(
        fixed,
        "1",
        name="Firefighter John Doe",
        agency="Fire Department",
        source="https://firehero.org/x",
        text="He went in. Corrected.",
        photo=DRAFT["photo"],
    )
    check("the edit defers, then rewrites the review post", fixed.response.kind == "defer")
    check("the buttons stay", fixed.edits[-1]["view"] is not None)
    check("an unchanged photo is left alone", "attachments" not in fixed.edits[-1])
    stored = (await cog.config.guild(guild).submissions())["1"]
    check("the edit is stored", stored["text"].endswith("Corrected."))
    check("a typed agency is understood", stored["agency"] == "fire")
    check("the editor is recorded", stored["edited_by"] == admin.id)
    check("the mirror survives the edit", stored["photo_mirrored"] is True)

    rejected = FakeInteraction(guild, admin)
    await cog.admin_edit_submitted(
        rejected, "1", name="X", agency="Navy", source="nope", text="t", photo=""
    )
    check("a nonsense edit is refused", "Not saved" in rejected.response.payload["content"])
    stored = (await cog.config.guild(guild).submissions())["1"]
    check("and changes nothing", stored["name"] == "Firefighter John Doe")

    print("approving it")
    approving = FakeInteraction(guild, admin)
    await cog.handle_review_action(approving, "1", "approve")
    check("one memorial published", len(publish.sent) == 1)
    check("in the memorial channel, not the test one", test_channel.sent == [])
    posted = publish.sent[0]
    check("the fire role is tagged", posted["content"] == "<@&627946690024046675>")
    check(
        "and the ping is allowed through",
        [r.id for r in posted["allowed_mentions"].roles] == [627946690024046675],
    )
    check("the submitter is credited", "Submitted by Brand" in posted["embed"].footer.text)
    check("published in memorial colours", posted["embed"].color.value == 0x2C3E50)
    published_message = publish.messages[max(publish.messages)]
    check(
        "the photo is re-uploaded, read back off the review message",
        len(posted["files"]) == 1
        and published_message.attachments[0]._data == b"JPEGBYTES",
    )
    check(
        "the memorial shows its own copy, not the dying link",
        posted["embed"].image.url == "attachment://fallen-hero.jpg",
    )
    check("the review post loses its buttons", approving.edits[-1]["view"] is None)

    stored = (await cog.config.guild(guild).submissions())["1"]
    check("marked approved", stored["status"] == "approved")
    check("the decider is recorded", stored["decided_by"] == admin.id)
    check("the published message is linked", stored["published_message_id"] is not None)
    check("the member is DM'd", len(member.dms) == 1)
    check("the DM says approved", "approved" in member.dms[0]["embed"].title)

    print("approving twice does nothing twice")
    again = FakeInteraction(guild, admin)
    await cog.handle_review_action(again, "1", "approve")
    check("no second post", len(publish.sent) == 1)
    check("and the admin is told", "Already" in again.followup.sent[-1]["content"])

    print("ambulance publishes silently")
    ambulance = FakeInteraction(guild, admin)
    await cog.handle_review_action(ambulance, "2", "approve")
    check("published", len(publish.sent) == 2)
    check("with no ping at all", publish.sent[1]["content"] is None)
    check(
        "and nothing allowed to ping",
        publish.sent[1]["allowed_mentions"].roles is False,
    )

    print("denying")
    draft3 = dict(DRAFT, name="Officer Sam Poe", agency="police")
    sent3 = FakeInteraction(guild, member)
    await cog.submit_for_approval(sent3, draft3)
    denying = FakeInteraction(guild, admin)
    await cog.handle_review_action(denying, "3", "deny")
    check("deny opens the reason modal", denying.response.kind == "send_modal")
    reason = FakeInteraction(guild, admin)
    await cog.deny_submitted(reason, "3", reason="Source is a Facebook post.")
    stored = (await cog.config.guild(guild).submissions())["3"]
    check("marked denied", stored["status"] == "denied")
    check("the reason is kept", "Facebook" in stored["reason"])
    check("nothing was published", len(publish.sent) == 2)
    check("the member is told why", "Facebook" in member.dms[-1]["embed"].description)
    check("the review post is closed out", reason.edits[-1]["view"] is None)

    print("test mode")
    await cog.config.guild(guild).test_mode.set(True)
    draft4 = dict(DRAFT, name="Firefighter Test Case")
    sent4 = FakeInteraction(guild, member)
    await cog.submit_for_approval(sent4, draft4)
    check("the review post goes to the test channel", len(test_channel.sent) == 1)
    check("not to the real review channel", len(review.sent) == 3)
    stored = (await cog.config.guild(guild).submissions())["4"]
    check("stamped as a test", stored["test"] is True)
    check("the member is warned", "test mode" in sent4.edits[-1]["content"])

    # The point of stamping it: flipping the switch back must not promote a
    # rehearsal into the real memorial channel.
    await cog.config.guild(guild).test_mode.set(False)
    approve_test = FakeInteraction(guild, admin)
    await cog.handle_review_action(approve_test, "4", "approve")
    check("a test approved after the switch flipped stays a test", len(test_channel.sent) == 2)
    check("the memorial channel is untouched", len(publish.sent) == 2)
    check("test posts are marked as such", test_channel.sent[1]["embed"].footer.text.startswith("TEST"))
    check("and stay silent", test_channel.sent[1]["content"] is None)

    print("test mode with pings on")
    await cog.config.guild(guild).test_mode.set(True)
    await cog.config.guild(guild).test_ping.set(True)
    sent5 = FakeInteraction(guild, member)
    await cog.submit_for_approval(sent5, dict(DRAFT, name="Ping Test"))
    approve5 = FakeInteraction(guild, admin)
    await cog.handle_review_action(approve5, "5", "approve")
    check("the role is tagged for real", test_channel.sent[-1]["content"] == "<@&627946690024046675>")
    await cog.config.guild(guild).test_mode.set(False)

    print("a photo that cannot be mirrored")
    # A realistic fbcdn link: signed (oh=/oe=), .png path, and long. The host
    # refuses the bot, so the post has to fall back to hotlinking — with
    # warnings everywhere someone can still do something about it.
    fb_url = (
        "https://scontent-fra5-2.xx.fbcdn.net/v/t39.99422-6/768350885_n.png"
        "?stp=dst-jpg_tt6&_nc_oc=" + "AdqaMGSrP6fCi3h32xnkRwrgX1bCwl5j6CH7K" * 8
        + "&oh=00_AQESLKFGGG&oe=6A7FCE48"
    )
    NEXT_PHOTO["photo"] = None
    NEXT_PHOTO["why"] = "the server answered `403`"
    fb_draft = {"agency": "police", "name": "", "source": "", "text": "", "photo": ""}
    fb = FakeInteraction(guild, member)
    await cog.details_submitted(
        fb,
        fb_draft,
        name="Officer F. B. Cdn",
        source="https://odmp.org/officer/1",
        text="Their story.",
        photo=fb_url,
    )
    fb_preview = fb.edits[-1]
    check("the failure is reported", "could not be downloaded" in fb_preview["content"])
    check("and the expiry is explained", "signed and will expire" in fb_preview["content"])
    check("but the submission is not blocked", fb_preview["view"].send.disabled is False)
    check("the embed hotlinks meanwhile", fb_preview["embed"].image.url == fb_url)
    check("no attachment on the preview", fb_preview["attachments"] == [])

    sent_fb = FakeInteraction(guild, member)
    await cog.submit_for_approval(sent_fb, fb_draft)
    stored = (await cog.config.guild(guild).submissions())["6"]
    check("stored as not mirrored", stored["photo_mirrored"] is False)
    status_fields = {f.name: f.value for f in review.sent[-1]["embeds"][1].fields}
    check(
        "the admins are warned it will die",
        "expiring link" in status_fields["Photo"],
        status_fields["Photo"],
    )
    approve_fb = FakeInteraction(guild, admin)
    await cog.handle_review_action(approve_fb, "6", "approve")
    posted_fb = publish.sent[-1]
    check("published hotlinked", posted_fb["embed"].image.url == fb_url)
    check("with no file", not posted_fb.get("files"))
    NEXT_PHOTO["photo"] = Photo(b"JPEGBYTES", "fallen-hero.jpg", "image/jpeg")
    NEXT_PHOTO["why"] = None

    print("data deletion")
    await cog.red_delete_data_for_user(requester="user", user_id=member.id)
    subs = await cog.config.guild(guild).submissions()
    check("the submitter is forgotten", all(s["user_id"] is None for s in subs.values()))
    check("the decisions survive", subs["1"]["status"] == "approved")

    print("re-registering after a restart")
    draft6 = dict(DRAFT, name="Restart Case")
    sent6 = FakeInteraction(guild, member)
    await cog.submit_for_approval(sent6, draft6)
    fresh = CuffFallen(FakeBot(guild, owner_id=999))
    fresh.bot.guilds = [guild]
    await fresh.cog_load()
    registered = [kw.get("message_id") for _, kw in fresh.bot.views if kw]
    check("the one pending review is re-adopted", len(registered) == 1, str(registered))
    check("panel plus one review view", len(fresh.bot.views) == 2)


asyncio.run(main())

shutil.rmtree(DATA, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED: " + ", ".join(failures))
    sys.exit(1)
print("all good")
