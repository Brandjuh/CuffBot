"""End-to-end on the real cog: real Red Config (temp data dir), real patch.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_cog.py

The live instance's data directory is never touched — Config is pointed at a
throwaway directory before the cog is imported.
"""

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(tempfile.mkdtemp(prefix="cuffembed-test-"))

from redbot.core import data_manager

data_manager.basic_config = {
    "DATA_PATH": str(DATA),
    "CORE_PATH_APPEND": "core",
    "COG_PATH_APPEND": "cogs",
    "STORAGE_TYPE": "JSON",
    "STORAGE_DETAILS": {},
}

import discord
from redbot.core import commands

from cuffembed import wrap
from cuffembed.cuffembed import CuffEmbed

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


class Recorder:
    def __init__(self):
        self.calls = []

    async def __call__(self, target, content=None, **kwargs):
        self.calls.append((content, kwargs))
        return "sent"

    @property
    def last(self):
        return self.calls[-1]


class FakeEconomy:
    qualified_name = "Economy"


FakeEconomy.__module__ = "redbot.cogs.economy.economy"


class FakeAudio:
    qualified_name = "Audio"


FakeAudio.__module__ = "redbot.cogs.audio.core"


class FakeChannel:
    guild = None


class FakeCtx:
    def __init__(self, cog):
        self.channel = FakeChannel()
        self.cog = cog
        self.clean_prefix = "!"


PAYDAY = "<@7> Here, take some donuts. Enjoy! (+250 donuts!)\n\nYou currently have 12,750 donuts."


async def main():
    recorder = Recorder()
    commands.Context.send = recorder
    discord.abc.Messageable.send = Recorder()

    cog = CuffEmbed(bot=type("Bot", (), {"cogs": {}})())
    await cog.cog_load()
    print("real cog")
    check("hook installed by cog_load", wrap.is_installed())
    check("defaults cover economy + payday", {"economy", "payday"} <= cog.allowed_keys())

    ctx = FakeCtx(FakeEconomy())
    await commands.Context.send(ctx, PAYDAY)
    content, kwargs = recorder.last
    check("payday becomes an embed", isinstance(kwargs.get("embed"), discord.Embed))
    check("titled Payday", kwargs["embed"].title == "💰 Payday")
    check("no ping content", content is None)

    await commands.Context.send(FakeCtx(FakeAudio()), "Now playing: something")
    content, kwargs = recorder.last
    check("audio untouched", content == "Now playing: something" and "embed" not in kwargs)

    # The off switch, through Config.
    await cog.config.enabled.set(False)
    await commands.Context.send(ctx, PAYDAY)
    content, kwargs = recorder.last
    check("off = plain text again", content == PAYDAY and "embed" not in kwargs)
    await cog.config.enabled.set(True)

    # Widening the allow-list must reach the synchronous mirror too.
    await cog.config.cogs.set(sorted(set(await cog.config.cogs()) | {"trivia"}))
    await cog._refresh_keys()
    check("add reaches allowed_keys", "trivia" in cog.allowed_keys())

    # A custom default colour is honoured for unrecognised text.
    await cog.config.color.set(0x00FF00)
    await commands.Context.send(ctx, "Something the rules do not know about.")
    content, kwargs = recorder.last
    check("custom colour used", kwargs["embed"].color.value == 0x00FF00)
    # A recognised message keeps its own colour, not the configured default.
    await commands.Context.send(ctx, PAYDAY)
    check("payout stays green", recorder.last[1]["embed"].color.value == wrap.GREEN)

    # Ping mode end to end.
    await cog.config.ping.set(True)
    await commands.Context.send(ctx, PAYDAY)
    content, kwargs = recorder.last
    check("ping content is the mention", content == "<@7>")
    await cog.config.ping.set(False)

    # Unload puts everything back.
    cog.cog_unload()
    check("unload restores Context.send", commands.Context.send is recorder)

    # And the settings survived as real JSON.
    stored = DATA / "cogs" / "CuffEmbed" / "settings.json"
    check("settings persisted", stored.exists(), str(stored))
    shutil.rmtree(DATA, ignore_errors=True)


asyncio.run(main())

print()
if failures:
    print(f"{len(failures)} FAILED: {failures}")
    sys.exit(1)
print("all checks passed")
