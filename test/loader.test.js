// Loader smoke test: proves every module manifest resolves and is well-formed
// without needing a token or a network connection. Catches broken imports,
// malformed manifests, and duplicate command names at test time instead of at
// boot time on the owner's machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverModules, validateFlatCommand, validateGroup } from '../src/core/loader.js';

test('every module manifest resolves and is well-formed', async () => {
  const modules = await discoverModules();
  assert.ok(modules.length >= 1, 'expected at least the core module');
  for (const mod of modules) {
    assert.ok(mod.name, 'module needs a name');
    assert.ok(mod.description, `module "${mod.name}" needs a description`);
    assert.ok(Array.isArray(mod.commands), `module "${mod.name}" needs commands[]`);
    assert.ok(Array.isArray(mod.events), `module "${mod.name}" needs events[]`);
  }
});

test('every command is a well-formed group or legacy data/execute command', async () => {
  const modules = await discoverModules();
  for (const mod of modules) {
    for (const command of mod.commands) {
      if (command.group) {
        // Red-style group (S69): the loader's validateGroup throws on bad shape.
        assert.doesNotThrow(
          () => validateGroup(mod, command.group),
          `group "${command.group?.name}" in "${mod.name}" is malformed`,
        );
        continue;
      }
      if (command.command) {
        // Flat command (S93): same validation, one command instead of a family.
        assert.doesNotThrow(
          () => validateFlatCommand(mod, command.command),
          `command "${command.command?.name}" in "${mod.name}" is malformed`,
        );
        continue;
      }
      assert.ok(command.data?.name, `command in "${mod.name}" needs data.name`);
      assert.ok(
        command.data?.description,
        `command "!${command.data?.name}" needs a description`,
      );
      assert.equal(
        typeof command.execute,
        'function',
        `command "!${command.data?.name}" needs execute()`,
      );
    }
  }
});

test('command names and group aliases are unique across all modules', async () => {
  const modules = await discoverModules();
  const names = modules.flatMap((mod) =>
    mod.commands.flatMap((cmd) =>
      cmd.group
        ? [cmd.group.name, ...(cmd.group.aliases ?? [])]
        : cmd.command
          ? [cmd.command.name, ...(cmd.command.aliases ?? [])]
          : [cmd.data.name],
    ),
  );
  assert.equal(new Set(names).size, names.length, `duplicate command names in: ${names}`);
});

test('group aliases resolve to the same command as the primary name (S70)', async () => {
  const { loadModules } = await import('../src/core/loader.js');
  const client = { on: () => {}, once: () => {} };
  await loadModules(client);
  for (const [alias, primary] of [
    ['memorial-config', 'memorial'],
    ['economy-config', 'economy'],
    ['xp-config', 'xp'],
    ['ai-config', 'ai'],
    ['birthday-config', 'birthday'],
    ['chat-starter-config', 'chat-starter'],
    ['starboard-config', 'starboard'],
    ['welcome-config', 'welcome'],
    ['channel-list-config', 'channel-list'],
  ]) {
    const viaAlias = client.commands.get(alias);
    assert.ok(viaAlias, `alias "${alias}" is registered`);
    assert.equal(viaAlias, client.commands.get(primary), `"${alias}" reaches !${primary}`);
  }
});

test('every event has a name and an execute function', async () => {
  const modules = await discoverModules();
  for (const mod of modules) {
    for (const event of mod.events) {
      assert.ok(event.name, `event in "${mod.name}" needs a name`);
      assert.equal(typeof event.execute, 'function', `event "${event.name}" needs execute()`);
    }
  }
});

/**
 * S117 — every game whose SOURCE cog is a plain command must play on the bare
 * word, not answer with a menu.
 *
 * The owner reported it as *"hangman werkt niet zoals het hoort"*: FlameCogs'
 * `[p]hangman` starts a game, and `!hangman` printed an overview instead. It
 * was not one module's slip — all seven of these are `@commands.hybrid_command`
 * upstream, and all seven had the same defect, because the S106 sweep that
 * introduced `invokeWithoutSubcommand` only examined the flat commands it was
 * FOLDING into groups. These were groups from birth (S72–S83), so nothing ever
 * compared their bare form against the source.
 *
 * Listed explicitly rather than derived: the correct answer comes from reading
 * each source cog, so a rule computed from our own code could not disagree
 * with us (S111 / skill 0.5.35). `mafia`, `hunting` and `heist` are absent on
 * purpose — their sources are groups or hubs, so a menu IS right for them.
 */
const PLAYS_ON_THE_BARE_WORD = [
  'hangman',
  'russianroulette',
  'splitorsteal',
  'guessthecandy',
  'rollout',
  'memory',
  'wordle',
  'trivia',
  'connect4',
];

test('a game whose source is a plain command starts on the bare word', async () => {
  const modules = await discoverModules();
  const groups = new Map();
  for (const mod of modules) {
    for (const cmd of mod.commands ?? []) {
      if (cmd.group) groups.set(cmd.group.name, cmd.group);
    }
  }

  const broken = [];
  for (const name of PLAYS_ON_THE_BARE_WORD) {
    const group = groups.get(name);
    if (!group) {
      broken.push(`${name}: no such group`);
      continue;
    }
    if (!group.invokeWithoutSubcommand) {
      broken.push(`!${name} answers with a menu; its source cog starts a game`);
      continue;
    }
    if (!group.fallback) {
      broken.push(`!${name} sets invokeWithoutSubcommand without a fallback`);
      continue;
    }
    if (!group.subcommands.some((s) => s.name === group.fallback)) {
      broken.push(`!${name} falls back to "${group.fallback}", which is not one of its subcommands`);
    }
  }
  assert.deepEqual(broken, [], broken.join('\n'));
});

test('a bare-playable group never needs arguments to start', async () => {
  // `invokeWithoutSubcommand` invokes the fallback with ZERO tokens, so a
  // required arg would turn every bare invocation into a usage error — a
  // worse failure than the menu it replaced.
  const modules = await discoverModules();
  const offenders = [];
  for (const mod of modules) {
    for (const cmd of mod.commands ?? []) {
      const group = cmd.group;
      if (!group?.invokeWithoutSubcommand) continue;
      const sub = group.subcommands.find((s) => s.name === group.fallback);
      const required = (sub?.args ?? []).filter((a) => a.required).map((a) => a.name);
      if (required.length) offenders.push(`!${group.name} → ${sub.name} requires ${required.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});
