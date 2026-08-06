"""cuffidwatch pure helpers + cog shape.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_idwatch.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import discord

from cuffidwatch.cuffidwatch import (
    DEFAULT_SEEDED,
    CuffIdWatch,
    embed_text,
    extract_ids,
    harvest_ids,
    snippet,
)

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


print("extract_ids")
check("plain id", extract_ids("ban 132620654087241729 please") == {132620654087241729})
check("two ids", len(extract_ids("132620654087241729 and 411157175948541954")) == 2)
check("mention is ignored", extract_ids("<@132620654087241729>") == set())
check("nick mention is ignored", extract_ids("<@!132620654087241729>") == set())
check("role mention is ignored", extract_ids("<@&411157175948541954>") == set())
check("channel link is ignored", extract_ids("<#411157175948541954>") == set())
check("custom emoji is ignored", extract_ids("<:donut:411157175948541954>") == set())
check("animated emoji is ignored", extract_ids("<a:siren:411157175948541954>") == set())
check("mention plus raw id", extract_ids("<@132620654087241729> aka 132620654087241729")
      == {132620654087241729})
check("too short", extract_ids("1234567890123456") == set())
check("too long", extract_ids("132620654087241729999") == set())
check("inside a longer run", extract_ids("99999132620654087241729") == set())
check("empty", extract_ids("") == set())
check("codeblock id", extract_ids("`132620654087241729`") == {132620654087241729})

print("embed_text / harvest_ids")
emb = discord.Embed(title="Case 44", description="Suspect: 132620654087241729")
emb.add_field(name="Reported by", value="411157175948541954")
emb.set_footer(text="ID: 132620654087241729")
text = embed_text(emb)
check("embed title", "Case 44" in text)
check("embed field", "411157175948541954" in text)
check("harvest content only", harvest_ids("132620654087241729", []) == {132620654087241729})
check("harvest embed too", len(harvest_ids("no ids here", [emb])) == 2)

print("snippet")
check("short passes through", snippet("hello") == "hello")
check("whitespace collapsed", snippet("a\n\n  b") == "a b")
check("long is cut with ellipsis", snippet("x" * 300).endswith("…"))
check("cut length", len(snippet("x" * 300)) == 200)

print("cog shape")
check("seed contains the requested user", 132620654087241729 in DEFAULT_SEEDED)
check("seed is ping + dm", DEFAULT_SEEDED[132620654087241729] == {"ping": True, "dm": True})
names = {c.qualified_name for c in CuffIdWatch.__cog_commands__}
check("user group", "idwatch" in names)
check("admin group", "idwatchset" in names)
check("subcommands", {"idwatch ping", "idwatch dm", "idwatch on", "idwatch off",
                      "idwatchset list", "idwatchset user"} <= names)

print()
if failures:
    print(f"{len(failures)} FAILED: {failures}")
    sys.exit(1)
print("all checks passed")
