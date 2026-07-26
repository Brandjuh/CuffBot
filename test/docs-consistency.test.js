// Every module has a manual, every manual has a module, and the index knows
// about all of them (S131).
//
// ⚠️ This is the fourth hand-maintained list in this repo to be found rotting,
// and the first three all rotted the same way: S43's `COMMAND_CATEGORIES` was
// guarded and survived; S116's `MODULE_BADGES` was not and named a module
// deleted nine sessions earlier (found S125); `STATE.md`'s verification block
// claimed a test count from four sessions back and still listed `connect4`
// (found S124, and its manuals row was STILL wrong until this session).
//
// The rule those three produced — *a map keyed by something the loader knows
// should be checked against the loader* (skill 0.5.46) — applies to the docs
// tree just as much as to a lookup table. `docs/` is a hand-maintained list of
// the modules; this is the four lines that keep it honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MANUAL_DIR = path.join(REPO, 'docs', 'modules');

const manuals = () =>
  readdirSync(MANUAL_DIR)
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replace(/\.md$/, ''))
    .sort();

const moduleNames = async () => {
  const { discoverModules } = await import('../src/core/loader.js');
  return (await discoverModules()).map((mod) => mod.name).sort();
};

test('the fixtures are real — the guards below cannot be checking empty lists', () => {
  // Without this, a broken readdir or a moved directory would make every
  // assertion in this file pass by having nothing to compare.
  assert.ok(manuals().length > 20, `only ${manuals().length} manuals found — is the path right?`);
});

test('every loaded module has a manual', async () => {
  const missing = (await moduleNames()).filter((name) => !manuals().includes(name));
  assert.deepEqual(missing, [], `no docs/modules/<name>.md for: ${missing.join(', ')}`);
});

test('every manual describes a module that still exists', async () => {
  // The direction that actually rotted: S116 replaced the `connect4` module
  // with `minigames`, and a manual for a deleted module is worse than none —
  // it documents behaviour the bot no longer has.
  const modules = await moduleNames();
  const orphans = manuals().filter((name) => !modules.includes(name));
  assert.deepEqual(orphans, [], `manuals with no module: ${orphans.join(', ')}`);
});

test('the manual index links every manual', () => {
  const index = readFileSync(path.join(REPO, 'docs', 'README.md'), 'utf8');
  const unlisted = manuals().filter((name) => !index.includes(`modules/${name}.md`));
  assert.deepEqual(unlisted, [], `not linked from docs/README.md: ${unlisted.join(', ')}`);
});

test('the index does not link a manual that is gone', () => {
  const index = readFileSync(path.join(REPO, 'docs', 'README.md'), 'utf8');
  const linked = [...index.matchAll(/modules\/([a-z0-9-]+)\.md/g)].map((m) => m[1]);
  const dead = [...new Set(linked)].filter((name) => !manuals().includes(name));
  assert.deepEqual(dead, [], `docs/README.md links missing manuals: ${dead.join(', ')}`);
});

// ── documented commands must exist (S133) ───────────────────────────────────
//
// The fifth hand-maintained list to be caught rotting, and the first one whose
// rot the owner hit as a *missing feature*. S122 removed `!city` as an alias of
// `!crime` and reserved the name "for the hub when it exists"; nothing built
// the hub, M26.3 was closed as COMPLETE, and `!city` answered with silence for
// eleven sessions — the router drops an unknown command without a word, so
// nothing failed and nothing logged. The city manual's own command table kept
// claiming `!city` for two of those sessions.
//
// Every guard above checks a list of MODULES against the loader. A manual's
// command table is a list of COMMANDS, and it is the list a player reads before
// typing. Same rule (skill 0.5.46), one level down.

/** `!name` from the first cell of a command-table row, per manual. */
const documentedCommands = () => {
  const found = new Map();
  for (const file of readdirSync(MANUAL_DIR).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(path.join(MANUAL_DIR, file), 'utf8');
    for (const [, name] of text.matchAll(/^\|\s*`!([a-z0-9-]+)[^|]*\|/gm)) {
      if (!found.has(name)) found.set(name, file);
    }
  }
  return found;
};

const registeredCommands = async () => {
  const { discoverModules } = await import('../src/core/loader.js');
  const names = new Set();
  for (const mod of await discoverModules())
    for (const entry of mod.commands ?? []) {
      const def = entry.group ?? entry.command;
      for (const name of [def.name, ...(def.aliases ?? [])]) names.add(name);
    }
  return names;
};

test('the command fixture is real — this cannot be checking an empty list', () => {
  const count = documentedCommands().size;
  assert.ok(count > 40, `only ${count} documented commands parsed — did the table format change?`);
});

test('every command a manual documents is one the loader registers', async () => {
  // The direction that rotted: a manual promising `!city` while the bot has no
  // such command. A player types it and gets silence, which reads as the bot
  // being broken rather than the docs being wrong.
  const registered = await registeredCommands();
  const phantom = [...documentedCommands()]
    .filter(([name]) => !registered.has(name))
    .map(([name, file]) => `!${name} (${file})`);
  assert.deepEqual(phantom, [], `documented but not registered: ${phantom.join(', ')}`);
});

test('STATE.md quotes no module list that can go stale', () => {
  // S124 and S131 both had to hand-correct the verification block's copied
  // lists. The fix is not another correction — it is not keeping the copy.
  // The block now says "run this and count", and the guards above are what
  // make the count meaningful.
  const state = readFileSync(path.join(REPO, 'STATE.md'), 'utf8');
  const block = state.slice(0, state.indexOf('## Resume point'));
  assert.doesNotMatch(
    block,
    /'academy',\s*'birthdays'/,
    'the verification block embeds a literal module list again — it will rot; assert a count instead',
  );
});
