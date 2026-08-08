"""KillCounter's kill announcement, on the real cog and real Red Config.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_killcounter.py

Config is pointed at a throwaway directory before the cog is imported, so the
live scoreboard is never touched.
"""

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(tempfile.mkdtemp(prefix="killcounter-test-"))

from redbot.core import data_manager

data_manager.basic_config = {
    "DATA_PATH": str(DATA),
    "CORE_PATH_APPEND": "core",
    "COG_PATH_APPEND": "cogs",
    "STORAGE_TYPE": "JSON",
    "STORAGE_DETAILS": {},
}

import discord

from killcounter.killcounter import KillCounter, _now_ms

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


class FakePerms:
    def __init__(self, ok=True):
        self.send_messages = ok
        self.embed_links = ok


class FakeChannel(discord.TextChannel):
    def __init__(self, channel_id, can_post=True):
        self.id = channel_id
        self._can_post = can_post
        self.sent = []

    def permissions_for(self, obj):
        return FakePerms(self._can_post)

    async def send(self, *, embed, **kwargs):
        self.sent.append(embed)
        return object()


class FakeAuthor:
    def __init__(self, user_id, bot=False):
        self.id = user_id
        self.bot = bot


class FakeMessage:
    def __init__(self, guild, channel, author, content="hoi"):
        self.guild = guild
        self.channel = channel
        self.author = author
        self.content = content


class FakeGuild:
    def __init__(self, guild_id, channel):
        self.id = guild_id
        self.me = object()
        self._channel = channel

    def get_channel(self, channel_id):
        return self._channel if self._channel.id == channel_id else None


class FakeBot:
    def __init__(self, guild):
        self._guild = guild

    def get_guild(self, guild_id):
        return self._guild if self._guild.id == guild_id else None

    async def get_valid_prefixes(self, guild):
        return ["!"]


GUILD_ID = 411157175948541954
CHANNEL_ID = 411609312037961729
KILLER = 297135938209972224
OTHER = 132620654087241729


def arm(cog, user_id, ago_ms=0):
    """Put a pending kill in place without waiting for a real timer."""
    cog._channels[CHANNEL_ID] = {"pending": (user_id, _now_ms() - ago_ms), "handle": None}


async def main():
    channel = FakeChannel(CHANNEL_ID)
    guild = FakeGuild(GUILD_ID, channel)
    cog = KillCounter(FakeBot(guild))
    await cog.config.guild(guild).silence_ms.set(3_600_000)  # the live 1 hour

    print("a scored kill is announced")
    arm(cog, KILLER, ago_ms=3_700_000)  # spoke over an hour ago
    result = await cog._fire_silence(GUILD_ID, CHANNEL_ID)
    check("the kill is awarded", result == (KILLER, 1), result)
    check("one embed posted in the dead channel", len(channel.sent) == 1)
    embed = channel.sent[0]
    check("titled", embed.title == "💀 Chat killed", embed.title)
    check("names the killer", f"<@{KILLER}>" in embed.description, embed.description)
    check("shows the new total", "kill **#1**" in embed.description, embed.description)
    check("shows the rank it just earned", "#1 of 1 on the board" in embed.description, embed.description)

    print("the announcement is not itself activity")
    bot_message = FakeMessage(guild, channel, FakeAuthor(999, bot=True))
    await cog._note_message(bot_message)
    check("no pending armed by the bot's own post", CHANNEL_ID not in cog._channels)

    print("a human re-arms, and the rank updates")
    await cog._note_message(FakeMessage(guild, channel, FakeAuthor(OTHER)))
    check("pending armed", cog._channels[CHANNEL_ID]["pending"][0] == OTHER)
    cog._channels[CHANNEL_ID]["handle"].cancel()
    arm(cog, KILLER, ago_ms=3_700_000)
    await cog._fire_silence(GUILD_ID, CHANNEL_ID)
    check("second kill counted", "kill **#2**" in channel.sent[-1].description, channel.sent[-1].description)

    print("still quiet when announcing is off")
    await cog.config.guild(guild).announce.set(False)
    before = len(channel.sent)
    arm(cog, KILLER, ago_ms=3_700_000)
    result = await cog._fire_silence(GUILD_ID, CHANNEL_ID)
    check("the kill is still scored", result == (KILLER, 3), result)
    check("but nothing is posted", len(channel.sent) == before)

    print("no permission → the point survives")
    await cog.config.guild(guild).announce.set(True)
    channel._can_post = False
    arm(cog, KILLER, ago_ms=3_700_000)
    result = await cog._fire_silence(GUILD_ID, CHANNEL_ID)
    check("scored anyway", result == (KILLER, 4), result)
    check("nothing posted", len(channel.sent) == before)

    print("a speaker who is still talking scores nothing")
    channel._can_post = True
    before = len(channel.sent)
    arm(cog, KILLER, ago_ms=60_000)  # spoke a minute ago, needs an hour
    check("no award", await cog._fire_silence(GUILD_ID, CHANNEL_ID) is None)
    check("no announcement", len(channel.sent) == before)

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
