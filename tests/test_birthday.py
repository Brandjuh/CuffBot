"""CuffBirthday's channel resolution — the InvalidData case that spammed the log.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_birthday.py

Config is pointed at a throwaway directory before the cog is imported, so the
live birthday list is never touched.
"""

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(tempfile.mkdtemp(prefix="cuffbirthday-test-"))

from redbot.core import data_manager

data_manager.basic_config = {
    "DATA_PATH": str(DATA),
    "CORE_PATH_APPEND": "core",
    "COG_PATH_APPEND": "cogs",
    "STORAGE_TYPE": "JSON",
    "STORAGE_DETAILS": {},
}

import discord

from cuffbirthday.cuffbirthday import DEFAULT_CHANNEL_ID, CuffBirthday

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


class _Response:
    status = 404
    reason = "test"


class FakeChannel(discord.TextChannel):
    def __init__(self, channel_id):
        self.id = channel_id

    @property
    def mention(self):
        return f"<#{self.id}>"


class FakeGuild:
    """``raises`` is what fetch_channel should throw; counts the API calls."""

    def __init__(self, guild_id, cached=None, raises=None):
        self.id = guild_id
        self._cached = cached
        self._raises = raises
        self.fetch_calls = 0

    def get_channel(self, channel_id):
        if self._cached is not None and self._cached.id == channel_id:
            return self._cached
        return None

    async def fetch_channel(self, channel_id):
        self.fetch_calls += 1
        if self._raises is not None:
            raise self._raises
        return FakeChannel(channel_id)


class FakeBot:
    guilds = []

    async def wait_until_red_ready(self):
        await asyncio.Event().wait()


HOME = 411157175948541954
OTHER = 1500189678765080758


async def main():
    cog = CuffBirthday(FakeBot())
    cog._startup.cancel()

    print("the channel is in this guild")
    home = FakeGuild(HOME, cached=FakeChannel(DEFAULT_CHANNEL_ID))
    resolved = await cog.resolve_channel(home, DEFAULT_CHANNEL_ID)
    check("resolved from cache", resolved is not None and resolved.id == DEFAULT_CHANNEL_ID)
    check("no API call needed", home.fetch_calls == 0, home.fetch_calls)

    print("the channel belongs to a different guild")
    # Exactly the live failure: the default channel id, swept in the guild it
    # does not belong to. InvalidData is a ClientException, not an
    # HTTPException, so it used to escape and log a traceback every 10 minutes.
    other = FakeGuild(OTHER, raises=discord.InvalidData("Guild ID resolved to a different guild"))
    check("does not raise", await cog.resolve_channel(other, DEFAULT_CHANNEL_ID) is None)
    check("asked the API once", other.fetch_calls == 1, other.fetch_calls)
    check("remembered as unreachable", (OTHER, DEFAULT_CHANNEL_ID) in cog._unreachable)

    for _ in range(5):
        await cog.resolve_channel(other, DEFAULT_CHANNEL_ID)
    check("never asks again", other.fetch_calls == 1, other.fetch_calls)

    print("a sweep over that guild is quiet")
    # sweep_birthdays used to let the exception through to the loop's handler.
    check("sweep returns 0", await cog.sweep_birthdays(other) == 0)
    check("still only the one API call", other.fetch_calls == 1, other.fetch_calls)

    print("a deleted channel settles too")
    gone = FakeGuild(3, raises=discord.NotFound(_Response(), "unknown channel"))
    check("resolves to None", await cog.resolve_channel(gone, 777) is None)
    await cog.resolve_channel(gone, 777)
    check("asked once", gone.fetch_calls == 1, gone.fetch_calls)

    print("a network blip is retried")
    flaky = FakeGuild(4, raises=discord.HTTPException(_Response(), "gateway down"))
    check("resolves to None", await cog.resolve_channel(flaky, 888) is None)
    check("not written off", (4, 888) not in cog._unreachable)
    await cog.resolve_channel(flaky, 888)
    check("asked again next time", flaky.fetch_calls == 2, flaky.fetch_calls)

    print("bad settings do not reach the API")
    empty = FakeGuild(5)
    check("no channel set", await cog.resolve_channel(empty, None) is None)
    check("garbage id", await cog.resolve_channel(empty, "nonsense") is None)
    check("no API calls", empty.fetch_calls == 0, empty.fetch_calls)

    print("re-setting the channel clears the verdict")
    cog._unreachable.add((OTHER, 12345))
    cog._unreachable = {pair for pair in cog._unreachable if pair[0] != OTHER}
    check("guild's verdicts dropped", not any(p[0] == OTHER for p in cog._unreachable))
    check("other guilds keep theirs", (3, 777) in cog._unreachable)

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
