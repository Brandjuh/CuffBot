import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHelp, renderHelpText, usageFor } from '../src/core/help.js';

const T = { STRING: 3, USER: 6 };

const MODULES = [
  {
    name: 'core',
    description: 'core',
    commands: [{ name: 'radio-check', description: 'Latency check', options: [] }],
  },
  {
    name: 'enforcement',
    description: 'enforcement',
    commands: [
      {
        name: 'cite',
        description: 'Issue a citation',
        options: [
          { name: 'target', type: T.USER, required: true },
          { name: 'reason', type: T.STRING, required: true },
          { name: 'penalty', type: T.STRING, required: false },
        ],
      },
    ],
  },
];

test('usageFor marks required <> and optional []', () => {
  assert.equal(usageFor('cite', MODULES[1].commands[0].options), 'cite <target> <reason> [penalty]');
  assert.equal(usageFor('radio-check', []), 'radio-check');
});

test('buildHelp groups by module and lists both invocation forms', () => {
  const model = buildHelp(MODULES, '!');
  assert.equal(model.groups.length, 2);
  const enforcement = model.groups.find((g) => g.title.includes('Enforcement'));
  const cite = enforcement.entries[0];
  assert.match(cite.invocations, /\/cite/);
  assert.match(cite.invocations, /!cite/);
  assert.match(cite.usage, /!cite <target> <reason> \[penalty\]/);
  assert.match(model.description, /2 commands/);
});

test('buildHelp skips modules with no commands', () => {
  const model = buildHelp([...MODULES, { name: 'empty', description: 'x', commands: [] }], '!');
  assert.ok(!model.groups.some((g) => g.title.includes('Empty')));
});

test('renderHelpText stays within the message limit', () => {
  const many = {
    name: 'core',
    description: 'core',
    commands: Array.from({ length: 60 }, (_, i) => ({
      name: `command-number-${i}`,
      description: 'A fairly wordy description repeated many times to bulk up the output.',
      options: [],
    })),
  };
  const text = renderHelpText(buildHelp([many], '!'));
  assert.ok(text.length <= 1990, `help text was ${text.length} chars`);
});
