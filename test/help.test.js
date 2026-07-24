import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMBED_FIELD_LIMIT,
  EMBED_MAX_FIELDS,
  EMBED_PAGE_BUDGET,
  buildHelp,
  paginateHelp,
  renderGroupChunks,
  renderHelpText,
  usageFor,
} from '../src/core/help.js';

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

test('renderGroupChunks splits oversized groups at entry boundaries', () => {
  const group = {
    title: '📻 Core',
    entries: Array.from({ length: 30 }, (_, i) => ({
      invocations: `\`/cmd-${i}\` · \`!cmd-${i}\``,
      usage: `\`!cmd-${i} <a> [b]\``,
      description: 'A fairly wordy description that bulks up each entry considerably.',
    })),
  };
  const chunks = renderGroupChunks(group);
  assert.ok(chunks.length > 1, 'a 30-command group cannot fit one field');
  for (const chunk of chunks) {
    assert.ok(chunk.length <= EMBED_FIELD_LIMIT, `chunk of ${chunk.length} chars`);
    assert.match(chunk, /^`\//, 'every chunk starts at an entry boundary');
  }
  const total = chunks.join('\n').split('usage:').length - 1;
  assert.equal(total, 30, 'no entry lost in the split');
});

test('paginateHelp keeps every page inside Discord embed limits (the S39 /help error)', () => {
  // 18 modules with realistic command counts — the shape that broke /help live.
  const many = Array.from({ length: 18 }, (_, m) => ({
    name: `module-${m}`,
    description: 'x',
    commands: Array.from({ length: 3 }, (_, c) => ({
      name: `mod${m}-command-${c}`,
      description: 'A description long enough to make the combined embed exceed the 6000-char total.',
      options: [{ name: 'target', type: 6, required: true }],
    })),
  }));
  const model = buildHelp(many, '!');
  const pages = paginateHelp(model);

  assert.ok(pages.length > 1, 'one embed cannot carry 18 modules');
  for (const page of pages) {
    const total =
      page.title.length +
      (page.description?.length ?? 0) +
      page.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    assert.ok(total <= 6_000, `page total ${total} exceeds the embed cap`);
    assert.ok(total <= EMBED_PAGE_BUDGET + page.title.length + (page.description?.length ?? 0));
    assert.ok(page.fields.length <= EMBED_MAX_FIELDS);
  }
  assert.match(pages[0].title, /\(1\/\d+\)/, 'pages are numbered');
  assert.equal(typeof pages[0].description, 'string', 'intro only on page 1');
  assert.equal(pages[1].description, null);
  const fieldCount = pages.reduce((n, p) => n + p.fields.length, 0);
  assert.ok(fieldCount >= 18, 'every module group survived pagination');
});

test('paginateHelp leaves a small roster on a single unnumbered page', () => {
  const pages = paginateHelp(buildHelp(MODULES, '!'));
  assert.equal(pages.length, 1);
  assert.ok(!pages[0].title.includes('(1/'), 'no page numbers when one page suffices');
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
