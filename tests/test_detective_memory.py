"""CuffDetective's case file, on the real cog and real Red Config.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_detective_memory.py

Config is pointed at a throwaway directory before the cog is imported, so the
live settings are never touched. No request ever reaches Groq.
"""

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(tempfile.mkdtemp(prefix="detective-test-"))

from redbot.core import data_manager

data_manager.basic_config = {
    "DATA_PATH": str(DATA),
    "CORE_PATH_APPEND": "core",
    "COG_PATH_APPEND": "cogs",
    "STORAGE_TYPE": "JSON",
    "STORAGE_DETAILS": {},
}

import discord

from cuffdetective.cuffdetective import (
    KNOWLEDGE_ADDED_EMOJI,
    KNOWLEDGE_FULL_EMOJI,
    MAX_KNOWLEDGE_TOKENS,
    PERSONA,
    CuffDetective,
)

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


GUILD_ID = 411157175948541954
FILE_ID = 1567248111028412426
ADMIN = 1
MEMBER = 2
GONE = 3
BOT = 4


class FakeMessage:
    def __init__(self, message_id, channel, author_id, content, *, bot=False):
        self.id = message_id
        self.channel = channel
        self.guild = channel.guild
        self.author = SimpleNamespace(id=author_id, bot=bot)
        self.content = self.clean_content = content
        self.reactions = []

    def is_system(self):
        return False

    async def add_reaction(self, emoji):
        self.reactions.append(emoji)


class FakeChannel:
    def __init__(self, guild, channel_id):
        self.guild = guild
        self.id = channel_id
        self.messages = []
        self.reads = 0
        self.broken = False
        self.sent = []
        self.mention = f"<#{channel_id}>"
        self.perms = SimpleNamespace(
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            add_reactions=True,
        )
        self.send_fails = False

    def permissions_for(self, member):
        return self.perms

    async def send(self, content, **kwargs):
        if self.send_fails:
            raise discord.HTTPException(SimpleNamespace(status=403, reason="nope"), "no access")
        self.sent.append(content)
        message = FakeMessage(9_000 + len(self.sent), self, BOT, content, bot=True)
        self.messages.append(message)
        return message

    async def history(self, *, limit, oldest_first):
        self.reads += 1
        if self.broken:
            raise discord.HTTPException(SimpleNamespace(status=403, reason="nope"), "no access")
        for message in sorted(self.messages, key=lambda m: m.id)[:limit]:
            yield message

    def post(self, message_id, author_id, content, **kwargs):
        message = FakeMessage(message_id, self, author_id, content, **kwargs)
        self.messages.append(message)
        return message


class FakeContext:
    clean_prefix = "!"

    def __init__(self, guild):
        self.guild = guild
        self.replies = []
        self.ticks = 0

    async def send(self, content):
        self.replies.append(content)

    async def tick(self):
        self.ticks += 1


class FakeGuild:
    id = GUILD_ID
    me = SimpleNamespace(id=BOT)

    def __init__(self):
        self.channel = FakeChannel(self, FILE_ID)

    def get_channel(self, channel_id):
        return self.channel if channel_id == FILE_ID else None

    def get_member(self, user_id):
        return None if user_id == GONE else SimpleNamespace(
            id=user_id, guild_permissions=SimpleNamespace(manage_guild=user_id == ADMIN)
        )

    async def fetch_member(self, user_id):
        response = SimpleNamespace(status=404, reason="gone")
        raise discord.NotFound(response, "Unknown Member")


class FakeBot:
    async def wait_until_ready(self):
        pass

    async def is_admin(self, member):
        return False

    async def get_context(self, message):
        return SimpleNamespace(valid=message.content.startswith("!"))


def entries(cog):
    return [text for _, text in cog._knowledge[GUILD_ID]["entries"]]


def edit_event(channel_id=FILE_ID):
    return SimpleNamespace(guild_id=GUILD_ID, channel_id=channel_id)


async def main():
    guild = FakeGuild()
    channel = guild.channel
    cog = CuffDetective(FakeBot())
    try:
        print("adding")
        fact = channel.post(10, ADMIN, "The Chief is Sam and hates decaf.")
        await cog._on_knowledge_post(fact)
        check("an admin's post enters the case file", entries(cog) == [fact.content])
        check("and gets the brain reaction", fact.reactions == [KNOWLEDGE_ADDED_EMOJI])

        chatter = channel.post(11, MEMBER, "I am the real Chief now.")
        await cog._on_knowledge_post(chatter)
        check("a non-admin's post is ignored", chatter.content not in entries(cog))
        check("without a reaction", chatter.reactions == [])

        channel.post(12, ADMIN, "!ai memory")
        channel.post(13, BOT, "Bot chatter.", bot=True)
        channel.post(14, GONE, "From someone who left.")
        channel.post(15, ADMIN, "   ")
        cog._knowledge_dirty.add(GUILD_ID)
        await cog._refresh_knowledge(guild)
        check(
            "commands, bots, former members and blanks stay out",
            entries(cog) == [fact.content],
            str(entries(cog)),
        )

        print("the prompt")
        messages = cog._build_messages(GUILD_ID, 99, "Ann", "Who is the Chief?")
        check("the case file is a system message", messages[0]["role"] == "system")
        check("holding the fact", fact.content in messages[0]["content"])
        check("before the question", messages[-1]["content"] == "Ann: Who is the Chief?")
        without = cog._request_tokens(1, 99, "Who is the Chief?")
        check(
            "and it counts against the token budget",
            cog._request_tokens(GUILD_ID, 99, "Who is the Chief?") > without,
        )

        sent = []

        class Response:
            status = 200

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            def raise_for_status(self):
                pass

            async def json(self):
                return {"choices": [{"message": {"content": "ok"}}]}

        def post(url, *, json, headers, timeout):
            sent.append(json)
            return Response()

        cog._session = SimpleNamespace(post=post, close=None)

        async def key():
            return "test"

        cog._api_key = key
        await cog._complete([{"role": "user", "content": "chat starter"}])
        body = str(sent[0]["messages"])
        check("the persona is sent", PERSONA in body)
        check("the chat starter does not pay for the case file", fact.content not in body)
        cog._session = None

        print("changing")
        reads = channel.reads
        await cog._refresh_knowledge(guild)
        check("an unchanged file is not read again", channel.reads == reads)

        fact.content = fact.clean_content = "The Chief is Alex."
        await cog.on_raw_message_edit(edit_event())
        await cog._refresh_knowledge(guild)
        check("an edit replaces the fact", entries(cog) == ["The Chief is Alex."])

        reads = channel.reads
        await cog.on_raw_message_edit(edit_event(555))
        await cog._refresh_knowledge(guild)
        check("activity in other channels costs nothing", channel.reads == reads)

        print("removing")
        channel.messages.remove(fact)
        await cog.on_raw_message_delete(edit_event())
        await cog._refresh_knowledge(guild)
        check("a delete forgets the fact", entries(cog) == [])
        check(
            "and an empty file adds nothing to the prompt",
            cog._build_messages(GUILD_ID, 99, "Ann", "hi")[0]["role"] == "user",
        )

        second = channel.post(20, ADMIN, "Second fact.")
        third = channel.post(21, ADMIN, "Third fact.")
        await cog.on_raw_message_edit(edit_event())
        await cog._refresh_knowledge(guild)
        check("facts come back in order", entries(cog) == [second.content, third.content])
        channel.messages.clear()
        await cog.on_raw_bulk_message_delete(edit_event())
        await cog._refresh_knowledge(guild)
        check("a bulk delete clears them too", entries(cog) == [])

        print("when full")
        old = channel.post(30, ADMIN, "x" * (MAX_KNOWLEDGE_TOKENS * 4 - 40))
        await cog._on_knowledge_post(old)
        overflow = channel.post(31, ADMIN, "y" * 400)
        await cog._on_knowledge_post(overflow)
        state = cog._knowledge[GUILD_ID]
        check("established facts are kept", entries(cog) == [old.content])
        check("the new post is flagged", overflow.reactions == [KNOWLEDGE_FULL_EMOJI])
        check("and listed as not fitting", state["skipped"] == [overflow.id])
        check("the cap holds", state["tokens"] <= MAX_KNOWLEDGE_TOKENS)
        short = channel.post(32, ADMIN, "Fits.")
        await cog._on_knowledge_post(short)
        check("a shorter later post can still fit", short.content in entries(cog))

        print("setting the channel")
        channel.messages.clear()
        await cog.config.guild(guild).knowledge_channel_id.clear()
        setter = cog.ai_memorychannel.callback
        ctx = FakeContext(guild)
        await setter(cog, ctx, channel)
        check("the command saves the channel", await cog.config.guild(guild).knowledge_channel_id() == FILE_ID)
        check("and posts one guide there", len(channel.sent) == 1)
        guide = channel.sent[0]
        for piece in ("post a message", "edit your message", "delete your message", "!ai memory"):
            check(f"the guide explains {piece!r}", piece in guide)
        check("the guide fits a Discord message", len(guide) <= 2000, f"{len(guide)} chars")
        check("and all is well", ctx.ticks == 1 and not ctx.replies)
        await cog._refresh_knowledge(guild)
        check("the guide itself is not a fact", entries(cog) == [])

        ctx = FakeContext(guild)
        channel.perms.add_reactions = False
        await setter(cog, ctx, channel)
        check("a missing permission is named", "Add Reactions" in ctx.replies[0])
        channel.perms.add_reactions = True

        ctx = FakeContext(guild)
        channel.perms.send_messages = False
        channel.send_fails = True
        await setter(cog, ctx, channel)
        check("no guide without Send Messages, and it says so", "Send Messages" in ctx.replies[0])
        channel.perms.send_messages = True

        ctx = FakeContext(guild)
        await setter(cog, ctx, channel)
        check("a failed post is reported even with permissions", "failed" in ctx.replies[0])
        channel.send_fails = False

        print("when the channel cannot be read")
        channel.messages.append(old)
        cog._knowledge_dirty.add(GUILD_ID)
        await cog._refresh_knowledge(guild)
        channel.broken = True
        cog._knowledge_dirty.add(GUILD_ID)
        await cog._refresh_knowledge(guild)
        state = cog._knowledge[GUILD_ID]
        check("known facts survive", old.content in entries(cog))
        check("the problem is reported", bool(state["error"]))
        channel.broken = False
        await cog._refresh_knowledge(guild)
        check("it recovers by itself", cog._knowledge[GUILD_ID]["error"] is None)
    finally:
        await cog.cog_unload()


try:
    asyncio.run(main())
finally:
    shutil.rmtree(DATA, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} check(s) FAILED: {failures}")
    sys.exit(1)
print("all checks passed")
