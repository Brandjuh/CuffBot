// Loader smoke test: proves every module manifest resolves and is well-formed
// without needing a token or a network connection. Catches broken imports,
// malformed manifests, and duplicate command names at test time instead of at
// boot time on the owner's machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverModules, validateGroup } from '../src/core/loader.js';

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
      cmd.group ? [cmd.group.name, ...(cmd.group.aliases ?? [])] : [cmd.data.name],
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
