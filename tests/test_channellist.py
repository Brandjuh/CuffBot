"""CuffChannelList's recovery paths, on the real cog and real Red Config.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_channellist.py

The live instance's data directory is never touched — Config is pointed at a
throwaway directory before the cog is imported. Discord is faked: the point is
what the cog does when the API says no, which cannot be provoked by hand
without wrecking the posted list.
"""

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(tempfile.mkdtemp(prefix="cuffchannellist-test-"))

from redbot.core import data_manager

data_manager.basic_config = {
    "DATA_PATH": str(DATA),
    "CORE_PATH_APPEND": "core",
    "COG_PATH_APPEND": "cogs",
    "STORAGE_TYPE": "JSON",
    "STORAGE_DETAILS": {},
}

import discord

from cuffchannellist.cuffchannellist import CuffChannelList
from cuffchannellist.listing import format_category_header

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


class FakeMessage:
    """A posted embed. ``edit_error``/``delete_error`` make the API refuse."""

    def __init__(self, channel, message_id, description, edit_error=None):
        self.channel = channel
        self.id = message_id
        self.embeds = [discord.Embed(description=description)]
        self.edit_error = edit_error
        self.deleted = False

    async def edit(self, *, embed):
        if self.edit_error:
            raise self.edit_error
        self.embeds = [embed]

    async def delete(self):
        self.deleted = True
        self.channel.messages.pop(self.id, None)


class FakePermissions:
    send_messages = True
    embed_links = True


class FakeChannel(discord.TextChannel):
    """Real class so the cog's isinstance check passes; no gateway behind it."""

    def __init__(self, channel_id, guild):
        self.id = channel_id
        self.guild = guild
        self.messages = {}
        self.sent = []
        self._next_id = 9000
        self.send_error = None

    def permissions_for(self, obj):
        return FakePermissions()

    async def fetch_message(self, message_id):
        if message_id not in self.messages:
            raise discord.NotFound(_Response(404), "unknown message")
        return self.messages[message_id]

    async def send(self, *, embed):
        if self.send_error:
            raise self.send_error
        self._next_id += 1
        message = FakeMessage(self, self._next_id, embed.description)
        self.messages[message.id] = message
        self.sent.append(message)
        return message

    def post(self, description, edit_error=None):
        self._next_id += 1
        message = FakeMessage(self, self._next_id, description, edit_error)
        self.messages[message.id] = message
        return message


class _Response:
    """Minimal stand-in for the aiohttp response discord errors want."""

    def __init__(self, status):
        self.status = status
        self.reason = "test"


class FakeRole:
    id = 1
    name = "@everyone"
    permissions = None


class FakeGuildChannel:
    def __init__(self, channel_id, name, kind, parent_id=None, position=0, topic=None):
        self.id = channel_id
        self.name = name
        self.type = kind
        self.category_id = parent_id
        self.position = position
        self.topic = topic

    def permissions_for(self, role):
        return type("P", (), {"view_channel": True})()


class FakeGuild:
    def __init__(self, guild_id, channels):
        self.id = guild_id
        self.channels = channels
        self.me = object()
        self.default_role = FakeRole()
        self._by_id = {}

    def get_role(self, role_id):
        return None

    def get_channel(self, channel_id):
        return self._by_id.get(channel_id)


class FakeBot:
    def __init__(self):
        self.guilds = []

    async def wait_until_red_ready(self):
        await asyncio.Event().wait()  # the sweep never runs during the test


def build(guild_id):
    """A guild with one category, one channel, and an empty target channel.

    Each case gets its own guild id: Config is keyed by it, and reusing one
    would let an earlier case's settings leak into the next.
    """
    category = FakeGuildChannel(100, "[ 🚔 POLITIE ]", discord.ChannelType.category, position=0)
    text = FakeGuildChannel(101, "meldkamer", discord.ChannelType.text, 100, 0, "Topic hier")
    guild = FakeGuild(guild_id, [category, text])
    target = FakeChannel(200, guild)
    guild._by_id[200] = target
    return guild, target


async def main():
    print("header brackets")
    check(
        "already-bracketed name is not wrapped again",
        format_category_header("[ 🚔 POLITIE ]") == "**[ 🚔 POLITIE ]**",
        format_category_header("[ 🚔 POLITIE ]"),
    )
    check(
        "plain name still gets one pair",
        format_category_header("POLITIE") == "**[POLITIE]**",
    )
    check(
        "emoji variant keeps one pair around the name",
        format_category_header("[ POLITIE ]", "🚔") == "**[🚔] [ POLITIE ] [🚔]**",
        format_category_header("[ POLITIE ]", "🚔"),
    )

    cog = CuffChannelList(FakeBot())
    cog._sweeper.cancel()

    print("first post")
    guild, target = build(411)
    await cog.config.guild(guild).channel_id.set(200)
    result = await cog.refresh(guild, force_repost=True)
    conf = await cog.config.guild(guild).all()
    check("posts", result == "posted", result)
    check("tracks the message it sent", conf["message_ids"] == [m.id for m in target.sent])
    check("renders the category once-bracketed", "**[ 🚔 POLITIE ]**" in target.sent[0].embeds[0].description)

    print("nothing changed")
    check("skips an identical render", await cog.refresh(guild) == "skipped")

    print("channel renamed")
    guild.channels[1].name = "meldkamer-2"
    guild.channels[1].topic = "Nieuw topic"
    before_ids = (await cog.config.guild(guild).all())["message_ids"]
    result = await cog.refresh(guild)
    after = await cog.config.guild(guild).all()
    check("edits in place", result == "edited", result)
    check("keeps the same message", after["message_ids"] == before_ids)
    check("new topic is in the embed", "Nieuw topic" in target.messages[before_ids[0]].embeds[0].description)

    print("edit refused → delete and repost")
    guild2, target2 = build(412)
    await cog.config.guild(guild2).channel_id.set(200)
    stale = target2.post("an out-of-date list", edit_error=discord.Forbidden(_Response(403), "no"))
    await cog.config.guild(guild2).message_channel_id.set(200)
    await cog.config.guild(guild2).message_ids.set([stale.id])
    result = await cog.refresh(guild2)
    conf2 = await cog.config.guild(guild2).all()
    check("reports a repair", result == "repaired", result)
    check("the un-editable message is deleted", stale.deleted)
    check("a fresh message is posted", len(target2.sent) == 1)
    check("tracking points at the new message", conf2["message_ids"] == [target2.sent[0].id])
    check("the stale text is gone", stale.id not in target2.messages)

    print("message deleted by hand → reposted")
    guild3, target3 = build(413)
    await cog.config.guild(guild3).channel_id.set(200)
    await cog.config.guild(guild3).message_channel_id.set(200)
    await cog.config.guild(guild3).message_ids.set([12345])  # never existed
    result = await cog.refresh(guild3)
    conf3 = await cog.config.guild(guild3).all()
    check("reposts", result == "posted", result)
    check("tracks the replacement", conf3["message_ids"] == [target3.sent[0].id])

    print("send dies halfway → what got posted stays tracked")
    guild4, target4 = build(414)
    await cog.config.guild(guild4).channel_id.set(200)
    target4.send_error = discord.HTTPException(_Response(500), "boom")
    try:
        await cog.refresh(guild4, force_repost=True)
    except discord.HTTPException:
        pass
    conf4 = await cog.config.guild(guild4).all()
    check("no orphans left untracked", conf4["message_ids"] == [m.id for m in target4.sent])

    cog.cog_unload()
    print()
    if failures:
        print(f"{len(failures)} FAILED: {', '.join(failures)}")
    else:
        print("all checks passed")
    return 1 if failures else 0


try:
    code = asyncio.run(main())
finally:
    shutil.rmtree(DATA, ignore_errors=True)
sys.exit(code)
