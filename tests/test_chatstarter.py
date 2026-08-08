"""CuffChatStarter's silent bails, now that each one names itself.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_chatstarter.py

Config is pointed at a throwaway directory before the cog is imported, so the
live instance's data is never touched.
"""

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(tempfile.mkdtemp(prefix="cuffchatstarter-test-"))

from redbot.core import data_manager

data_manager.basic_config = {
    "DATA_PATH": str(DATA),
    "CORE_PATH_APPEND": "core",
    "COG_PATH_APPEND": "cogs",
    "STORAGE_TYPE": "JSON",
    "STORAGE_DETAILS": {},
}

import discord

from cuffchatstarter.cuffchatstarter import CuffChatStarter

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


class FakePerms:
    def __init__(self, send=True):
        self.send_messages = send
        self.read_message_history = True


class FakeChannel(discord.TextChannel):
    def __init__(self, channel_id, name="algemeen", can_send=True):
        self.id = channel_id
        self.name = name
        self._can_send = can_send
        self.sent = []

    def permissions_for(self, obj):
        return FakePerms(self._can_send)

    @property
    def mention(self):
        return f"<#{self.id}>"

    async def send(self, content=None, **kwargs):
        self.sent.append(content)
        return object()


class FakeGuild:
    def __init__(self, guild_id, channel=None):
        self.id = guild_id
        self.me = object()
        self._channel = channel

    def get_channel(self, channel_id):
        if self._channel is not None and self._channel.id == channel_id:
            return self._channel
        return None


class FakeBot:
    def __init__(self):
        self.guilds = []
        self.user = None

    def get_cog(self, name):
        return None  # no detective: the AI path is skipped, bank is used

    async def cog_disabled_in_guild(self, cog, guild):
        return False

    async def wait_until_red_ready(self):
        await asyncio.Event().wait()


WATCHED = 411609312037961729


async def main():
    cog = CuffChatStarter(FakeBot())
    cog._startup.cancel()

    print("question bank")
    check("bundled bank loads", len(cog.question_bank()) > 0, f"{len(cog.question_bank())} questions")

    print("channel gone → named, not silent")
    guild = FakeGuild(1, channel=None)  # configured channel does not resolve
    posted = await cog.post_starter(guild)
    check("does not post", posted is False)
    check(
        "reason names the missing channel",
        str(WATCHED) in cog._last_reason.get(1, ""),
        cog._last_reason.get(1),
    )

    print("no send permission → named")
    muted = FakeChannel(WATCHED, "algemeen", can_send=False)
    guild2 = FakeGuild(2, channel=muted)
    check("does not post", await cog.post_starter(guild2) is False)
    check(
        "reason names the permission",
        "Send Messages" in cog._last_reason.get(2, ""),
        cog._last_reason.get(2),
    )

    print("healthy channel → posts, reason cleared")
    good = FakeChannel(WATCHED)
    guild3 = FakeGuild(3, channel=good)
    check("posts", await cog.post_starter(guild3) is True)
    check("one message sent", len(good.sent) == 1, good.sent[:1])
    check("reason cleared", cog._last_reason.get(3) == "", repr(cog._last_reason.get(3)))
    check("guard is disarmed after posting", cog.activity[WATCHED]["human_since_starter"] is False)

    print("sweep gates report themselves")
    guild4 = FakeGuild(4, channel=FakeChannel(WATCHED))
    await cog.config.guild(guild4).enabled.set(False)
    check("disabled sweep posts nothing", await cog.sweep(guild4) is False)
    check("reason is 'disabled'", cog._last_reason.get(4) == "disabled", cog._last_reason.get(4))

    await cog.config.guild(guild4).enabled.set(True)
    # Fresh activity record: last activity is "now", so it is nowhere near idle.
    cog.activity.pop(WATCHED, None)
    check("busy channel posts nothing", await cog.sweep(guild4) is False)
    check(
        "reason is 'not-idle-enough'",
        cog._last_reason.get(4) == "not-idle-enough",
        cog._last_reason.get(4),
    )

    # Wind the clock back past the 12-hour threshold.
    cog.activity[WATCHED]["last_activity_at"] -= 13 * 60 * 60 * 1000
    check("quiet channel posts", await cog.sweep(guild4) is True)
    check("reason cleared", cog._last_reason.get(4) == "")

    # And now the monologue guard should hold it back.
    check("no second starter in a row", await cog.sweep(guild4) is False)
    check(
        "reason is the human guard",
        cog._last_reason.get(4) == "no-human-since-last-starter",
        cog._last_reason.get(4),
    )

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
