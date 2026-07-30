"""Exercise cuffembed's wrapper against the real discord.py / Red classes.

The two originals are replaced with recording stubs BEFORE install(), so the
patched methods call the stubs instead of Discord's HTTP layer.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_wrap.py
"""

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
# `stub_callers` holds modules named after allow-listed cogs, so the stack walk
# in wrap.caller_key has something realistic to find.
sys.path.insert(0, str(REPO / "tests" / "stub_callers"))

import discord
from redbot.core import commands

from cuffembed import wrap

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


# ---------------------------------------------------------------- pure helpers
print("package_key / cog_keys")
check("core economy", wrap.package_key("redbot.cogs.economy.economy") == "economy")
check("downloaded cog", wrap.package_key("payday.payday") == "payday")
check("cog submodule", wrap.package_key("extendedeconomy.commands.admin") == "extendedeconomy")
check("core plumbing", wrap.package_key("redbot.core.bot") is None)
check("empty", wrap.package_key("") is None)


class FakeCog:
    qualified_name = "PayDay"


FakeCog.__module__ = "payday.payday"
check("cog_keys both names", wrap.cog_keys(FakeCog()) == {"payday"})
check("cog_keys of None", wrap.cog_keys(None) == set())

print("should_embed")
check("plain text", wrap.should_embed("You have been given 100 donuts", {}) is True)
check("already an embed", wrap.should_embed("hi there", {"embed": discord.Embed()}) is False)
check("embed=None is not blocking", wrap.should_embed("hi there", {"embed": None}) is True)
check("a view means a menu", wrap.should_embed("page 1 of 3", {"view": object()}) is False)
check("None content", wrap.should_embed(None, {}) is False)
check("a bare tick", wrap.should_embed("✅", {}) is False)
check("too long", wrap.should_embed("x" * 5000, {}) is False)
check("link keeps its preview", wrap.should_embed("https://youtu.be/abc", {}) is False)
check("suppress_embeds respected", wrap.should_embed("text", {"suppress_embeds": True}) is False)

print("rules")
PAYDAY = "<@123> Here, take some donuts. Enjoy! (+250 donuts!)\n\nYou currently have 12,750 donuts."
COOLDOWN = "<@123> Too soon. Your next payday is <t:1:R>."
FREE_ALL = "You have claimed all available donuts from the `freecredits` program! +900 donuts"
FREE_WAIT = "Sorry, you still have 6 hours until your next daily bonus"
check("payday payout", wrap.match_rule(PAYDAY).title == "💰 Payday")
check("payday cooldown", wrap.match_rule(COOLDOWN).title == "⏳ Not yet")
check("freecredits all", wrap.match_rule(FREE_ALL).title == "💰 Payday")
check("freecredits cooldown", wrap.match_rule(FREE_WAIT).title == "⏳ Not yet")
check("granted", wrap.match_rule("You have been given 50 donuts").title == "💰 Payday")
check("balance", wrap.match_rule("Your balance is 500 donuts").title == "🏦 Balance")
check("setting saved", wrap.match_rule("Setting saved").title == "✅ Setting saved")
check("refusal", wrap.match_rule("You must provide a non-negative value or 0").title == "🚫 No can do")
check("unknown text", wrap.match_rule("Some unrelated sentence.") is None)
check("payout beats balance", wrap.match_rule(PAYDAY).title == "💰 Payday", "order matters")

print("build_embed")
embed, ping = wrap.build_embed(PAYDAY, wrap.NEUTRAL)
check("payout colour", embed.color.value == wrap.GREEN)
check("no ping content by default", ping is None)
check("mention stays in the body", "<@123>" in embed.description)
embed, ping = wrap.build_embed(PAYDAY, wrap.NEUTRAL, ping=True)
check("ping lifts the mention out", ping == "<@123>")
check("body drops it", "<@123>" not in embed.description)
check("body keeps the rest", embed.description.startswith("Here, take some"))
embed, ping = wrap.build_embed("Some unrelated sentence.", 0x123456)
check("default colour used", embed.color.value == 0x123456)
check("no title when unmatched", embed.title is None)
embed, ping = wrap.build_embed("<@1> <@2>", wrap.NEUTRAL, ping=True)
check("mentions-only text is not gutted", ping is None and embed.description == "<@1> <@2>")


# --------------------------------------------------------------- the patch
class Recorder:
    """Stands in for the real send methods."""

    def __init__(self):
        self.calls = []

    async def __call__(self, target, content=None, **kwargs):
        self.calls.append((content, kwargs))
        return "sent"

    @property
    def last(self):
        return self.calls[-1]


class Policy:
    """The cog's plan(), without Config."""

    def __init__(self, keys, *, enabled=True, events=True, ping=False):
        self.keys = keys
        self.enabled = enabled
        self.events = events
        self.ping = ping
        self.seen = []

    def allowed_keys(self):
        return self.keys

    async def plan(self, destination, content, kwargs, keys, *, via_context):
        self.seen.append((keys, via_context))
        if not self.enabled or (not via_context and not self.events):
            return None
        if not keys or not (keys & self.keys):
            return None
        if not wrap.should_embed(content, kwargs):
            return None
        return wrap.build_embed(content, wrap.NEUTRAL, ping=self.ping)


class FakeChannel:
    guild = None  # can_embed short-circuits: nothing to check


class FakeContext:
    """Enough of a Context for the patched send: a channel and a cog."""

    def __init__(self, cog):
        self.channel = FakeChannel()
        self.cog = cog


async def main():
    ctx_recorder = Recorder()
    msg_recorder = Recorder()
    commands.Context.send = ctx_recorder
    discord.abc.Messageable.send = msg_recorder

    policy = Policy({"payday", "city"})
    wrap.install(policy)
    print("patch")
    check("installed", wrap.is_installed())

    ctx = FakeContext(FakeCog())
    result = await commands.Context.send(ctx, PAYDAY)
    content, kwargs = ctx_recorder.last
    check("returns the original's result", result == "sent")
    check("content replaced by an embed", content is None and "embed" in kwargs)
    check("embed carries the text", kwargs["embed"].title == "💰 Payday")

    # A cog that is not allow-listed is left completely alone.
    class OtherCog:
        qualified_name = "Audio"

    OtherCog.__module__ = "redbot.cogs.audio.core"
    await commands.Context.send(FakeContext(OtherCog()), "Now playing: something")
    content, kwargs = ctx_recorder.last
    check("foreign cog untouched", content == "Now playing: something" and "embed" not in kwargs)

    # An explicit embed=None must not become a duplicate keyword.
    await commands.Context.send(ctx, PAYDAY, embed=None)
    content, kwargs = ctx_recorder.last
    check("embed=None survives", isinstance(kwargs.get("embed"), discord.Embed))

    # Red's `filter` kwarg has to apply to the embed body too.
    await commands.Context.send(ctx, "You have been given @everyone donuts", filter=lambda s: s.replace("@everyone", "[redacted]"))
    content, kwargs = ctx_recorder.last
    check("filter applied to the body", "[redacted]" in kwargs["embed"].description)

    # Ping mode puts the mention back as real content.
    policy.ping = True
    await commands.Context.send(ctx, PAYDAY)
    content, kwargs = ctx_recorder.last
    check("ping content sent", content == "<@123>")
    check("allowed_mentions scoped", kwargs["allowed_mentions"].users is True and kwargs["allowed_mentions"].everyone is False)
    policy.ping = False

    # The channel path: identified by the calling module, not by a Context.
    import city

    dest = FakeChannel()
    await city.announce(dest, "A crook is loose in the precinct!")
    content, kwargs = msg_recorder.last
    check("event message wrapped", content is None and isinstance(kwargs.get("embed"), discord.Embed))

    policy.events = False
    await city.announce(dest, "A crook is loose in the precinct!")
    content, kwargs = msg_recorder.last
    check("events off leaves it plain", content == "A crook is loose in the precinct!")
    policy.events = True

    # A send from a module nobody allow-listed never even reaches the policy.
    before = len(policy.seen)
    await discord.abc.Messageable.send(dest, "internal bookkeeping")
    content, kwargs = msg_recorder.last
    check("unknown caller untouched", content == "internal bookkeeping")
    check("policy not consulted", len(policy.seen) == before)

    # A failing policy must degrade to plain text, never raise.
    class Exploding(Policy):
        async def plan(self, *a, **kw):
            raise RuntimeError("boom")

    wrap.remove()
    wrap.install(Exploding({"payday"}))
    await commands.Context.send(ctx, PAYDAY)
    content, kwargs = ctx_recorder.last
    check("crash falls back to plain text", content == PAYDAY and "embed" not in kwargs)

    # install() over an existing patch must not stack.
    wrap.install(policy)
    wrap.install(policy)
    wrap.remove()
    check("removed cleanly", commands.Context.send is ctx_recorder and discord.abc.Messageable.send is msg_recorder)

    # A reload re-imports the module with empty globals: the patch has to be
    # peelable from the marker it carries, not just from those globals.
    wrap.install(policy)
    wrap._original_context_send = None
    wrap._original_messageable_send = None
    wrap.install(policy)
    wrap.remove()
    check(
        "survives a reload with lost globals",
        commands.Context.send is ctx_recorder and discord.abc.Messageable.send is msg_recorder,
    )


asyncio.run(main())

print()
if failures:
    print(f"{len(failures)} FAILED: {failures}")
    sys.exit(1)
print("all checks passed")
