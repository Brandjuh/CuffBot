// The goal tracker (S103 = M14). The owner asked for "a goal tracker" and
// never said whose goals, so the module answers both readings with one shape —
// and these tests pin that both really work, rather than one being a
// side-effect of the other.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_GOALS_CONFIG,
  SOURCES,
  applyProgress,
  completedCount,
  createGoal,
  currentFromSource,
  findGoal,
  formatGoal,
  goalBoard,
  isComplete,
  milestoneMessage,
  percentOf,
  progressBar,
  slugify,
  sortGoals,
} from '../src/modules/goals/lib/goals.js';
import {
  getGoalsConfig,
  getGuildGoals,
  getMemberGoals,
  moveGoal,
  refreshTrackedGoals,
  resetGoals,
  setGoalsConfig,
  updateGuildGoals,
  updateMemberGoals,
} from '../src/modules/goals/service.js';
import goalCommand from '../src/modules/goals/commands/goal.js';
import { dispatchGroup } from '../src/core/prefix/group.js';
import { tokenize } from '../src/core/prefix/parse.js';
import { fakeMessage } from './fixtures/fake-message.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-goals-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `40000000000000${String((seq += 1)).padStart(4, '0')}`;
const ALICE = '800000000000000001';
const BOB = '800000000000000002';

const goalOf = (over = {}) =>
  createGoal({}, { name: 'Read 30 books', target: 30, now: 1_000, ...over }).goal;

// ── creating ─────────────────────────────────────────────────────────────────

test('a name becomes a stable id', () => {
  assert.equal(slugify('1000 Members'), '1000-members');
  assert.equal(slugify('  Read 30 Books!  '), 'read-30-books');
  assert.equal(slugify('C++ / Rust'), 'c-rust');
  assert.equal(slugify('!!!'), '', 'punctuation alone is not a name');
});

test('creating validates before it stores anything', () => {
  assert.equal(createGoal({}, { name: '', target: 5 }).message, 'A goal needs a name.');
  assert.equal(createGoal({}, { name: '!!!', target: 5 }).message, 'That name has no letters or digits in it.');
  assert.match(createGoal({}, { name: 'x'.repeat(81), target: 5 }).message, /longer than 80/);
  assert.match(createGoal({}, { name: 'ok', target: 0 }).message, /positive number/);
  assert.match(createGoal({}, { name: 'ok', target: -3 }).message, /positive number/);
  assert.match(createGoal({}, { name: 'ok', target: 5, source: 'wishes' }).message, /Unknown source/);

  const made = createGoal({}, { name: 'Read 30 books', target: 30, unit: 'books', by: ALICE, now: 42 });
  assert.equal(made.ok, true);
  assert.deepEqual(made.goal, {
    id: 'read-30-books',
    name: 'Read 30 books',
    target: 30,
    current: 0,
    unit: 'books',
    source: 'manual',
    by: ALICE,
    createdAt: 42,
    completedAt: null,
    announced: [],
  });

  const dupe = createGoal({ 'read-30-books': made.goal }, { name: 'READ 30 BOOKS', target: 5 });
  assert.equal(dupe.ok, false, 'the same name twice is refused, whatever the casing');
});

// ── progress ─────────────────────────────────────────────────────────────────

test('progress is clamped at both ends and completion is sticky', () => {
  const goal = goalOf();
  assert.equal(applyProgress(goal, -5).goal.current, 0, 'never negative');
  assert.equal(applyProgress(goal, 999).goal.current, 30, 'never past the target');

  const done = applyProgress(goal, 30, { now: 500 });
  assert.equal(done.justCompleted, true);
  assert.equal(done.goal.completedAt, 500);
  // Re-completing keeps the ORIGINAL timestamp — the goal was reached then.
  const again = applyProgress(done.goal, 30, { now: 900 });
  assert.equal(again.goal.completedAt, 500);
  assert.equal(again.justCompleted, false);
  // And falling back below the line reopens it.
  assert.equal(applyProgress(done.goal, 10).goal.completedAt, null);
});

test('a milestone is announced once, and a big jump announces once', () => {
  const goal = goalOf({ target: 100 });
  const marks = DEFAULT_GOALS_CONFIG.milestones;

  const quarter = applyProgress(goal, 25, { milestones: marks });
  assert.deepEqual(quarter.crossed, [25]);
  assert.deepEqual(quarter.goal.announced, [25]);

  // Staying at 25 crosses nothing new — this is what makes the sweep safe to
  // run every fifteen minutes forever.
  assert.deepEqual(applyProgress(quarter.goal, 25, { milestones: marks }).crossed, []);
  assert.deepEqual(applyProgress(quarter.goal, 30, { milestones: marks }).crossed, []);

  // One jump past several marks reports them all; the caller posts the highest.
  const jump = applyProgress(quarter.goal, 100, { milestones: marks });
  assert.deepEqual(jump.crossed, [50, 75, 100]);
  assert.equal(Math.max(...jump.crossed), 100);

  // Dropping back and climbing again does NOT re-announce.
  const dropped = applyProgress(jump.goal, 10, { milestones: marks });
  assert.deepEqual(applyProgress(dropped.goal, 100, { milestones: marks }).crossed, []);
});

test('percent and the bar never round an unfinished goal up to full', () => {
  assert.equal(percentOf({ current: 0, target: 30 }), 0);
  assert.equal(percentOf({ current: 15, target: 30 }), 50);
  assert.equal(percentOf({ current: 99, target: 100 }), 99);
  assert.equal(percentOf({ current: 5, target: 0 }), 0, 'no division by zero');

  // 99/100 must not print a full bar — the whole point is seeing you are not done.
  const nearly = progressBar({ current: 99, target: 100 }, 12);
  assert.equal(nearly.endsWith(' 99%'), true);
  assert.ok(nearly.includes('░'), 'still shows an empty segment');
  assert.equal(progressBar({ current: 100, target: 100 }, 12), `${'█'.repeat(12)} 100%`);
  assert.equal(progressBar({ current: 0, target: 100 }, 12), `${'░'.repeat(12)} 0%`);
});

test('a goal reads as a goal', () => {
  const goal = { ...goalOf({ unit: 'books' }), current: 12 };
  const text = formatGoal(goal);
  assert.match(text, /🎯 \*\*Read 30 books\*\* — 12 \/ 30 books/);
  assert.match(text, /`█+░+ 40%`/);
  assert.match(formatGoal({ ...goal, current: 30, completedAt: 1 }), /^✅/);
  assert.equal(formatGoal(goal, { bar: false }).includes('\n'), false);
});

// ── finding ──────────────────────────────────────────────────────────────────

test('finding a goal is tolerant, but an ambiguous match is an error not a guess', () => {
  const goals = {
    'read-30-books': goalOf(),
    'read-10-papers': { ...goalOf(), id: 'read-10-papers', name: 'Read 10 papers' },
    'run-a-marathon': { ...goalOf(), id: 'run-a-marathon', name: 'Run a marathon' },
  };
  assert.equal(findGoal(goals, 'read-30-books').goal.name, 'Read 30 books', 'by id');
  assert.equal(findGoal(goals, 'Read 30 books').goal.name, 'Read 30 books', 'by exact name');
  assert.equal(findGoal(goals, 'READ 30 BOOKS').goal.name, 'Read 30 books', 'case-insensitive');
  assert.equal(findGoal(goals, 'marathon').goal.name, 'Run a marathon', 'unique substring');

  // Editing the wrong goal silently is worse than asking again.
  const ambiguous = findGoal(goals, 'read');
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.message, /matches 2 goals/);
  assert.match(findGoal(goals, 'nothing').message, /No goal matches/);
  assert.match(findGoal(goals, '  ').message, /Name a goal/);
});

test('open goals sort before finished ones, closest first', () => {
  const goals = {
    a: { ...goalOf(), id: 'a', name: 'A', current: 30, completedAt: 1 },
    b: { ...goalOf(), id: 'b', name: 'B', current: 3 },
    c: { ...goalOf(), id: 'c', name: 'C', current: 27 },
  };
  assert.deepEqual(
    sortGoals(goals).map((g) => g.id),
    ['c', 'b', 'a'],
  );
});

// ── auto-tracked sources ─────────────────────────────────────────────────────

test('an auto-tracked source reads the guild; a manual goal is left alone', () => {
  assert.deepEqual(SOURCES, ['manual', 'members', 'boosts']);
  assert.equal(currentFromSource('members', { memberCount: 640, boostCount: 3 }), 640);
  assert.equal(currentFromSource('boosts', { memberCount: 640, boostCount: 3 }), 3);
  // null, not 0 — a manual goal's hand-kept number must never be overwritten.
  assert.equal(currentFromSource('manual', { memberCount: 640 }), null);
  assert.equal(currentFromSource('nonsense', {}), null);
});

test('the milestone message says something different at the finish line', () => {
  const goal = { ...goalOf({ target: 100, unit: 'members' }), current: 50 };
  assert.match(milestoneMessage(goal, 50), /is \*\*50%\*\* of the way there — 50 \/ 100 members/);
  assert.match(milestoneMessage({ ...goal, current: 100 }, 100), /Goal reached.*the precinct did it/s);
});

// ── the board ────────────────────────────────────────────────────────────────

test('the board ranks by goals finished and leaves out the empty-handed', () => {
  const done = (n) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`g${i}`, { ...goalOf(), id: `g${i}`, completedAt: 1 }]),
    );
  const all = {
    [ALICE]: { ...done(3), open1: { ...goalOf(), id: 'open1' } },
    [BOB]: done(5),
    nobody: { open: { ...goalOf(), id: 'open' } },
  };
  const board = goalBoard(all);
  assert.deepEqual(
    board.map((r) => [r.userId, r.completed, r.open]),
    [
      [BOB, 5, 0],
      [ALICE, 3, 1],
    ],
    'a board of zeroes tells nobody anything',
  );
  assert.equal(goalBoard(all, 1).length, 1);
  assert.equal(completedCount(all[ALICE]), 3);
  assert.equal(isComplete(goalOf()), false);
});

// ── the service ──────────────────────────────────────────────────────────────

/** A guild stand-in with the two counts the auto sources read. */
function fakeGuild(id, { memberCount = 0, boostCount = 0 } = {}) {
  const sent = [];
  return {
    id,
    memberCount,
    premiumSubscriptionCount: boostCount,
    sent,
    channels: { cache: new Map(), fetch: async () => null },
    channel: { send: async (p) => sent.push(p) },
  };
}

test('config is sparse and goals persist per guild', () => {
  const guildId = freshGuildId();
  assert.deepEqual(getGoalsConfig(guildId), DEFAULT_GOALS_CONFIG);
  assert.equal(setGoalsConfig(guildId, { announceChannelId: 'c1' }).milestones.length, 4, 'untouched');

  updateGuildGoals(guildId, (g) => ({ ...g, mine: goalOf() }));
  assert.equal(getGuildGoals(guildId).mine.name, 'Read 30 books');
  updateMemberGoals(guildId, ALICE, (g) => ({ ...g, mine: goalOf() }));
  assert.equal(Object.keys(getMemberGoals(guildId, ALICE)).length, 1);
  assert.deepEqual(getMemberGoals(guildId, BOB), {}, 'members do not see each other’s');

  resetGoals(guildId);
  assert.deepEqual(getGuildGoals(guildId), {});
  assert.deepEqual(getMemberGoals(guildId, ALICE), {});
});

test('moveGoal announces the highest crossed mark, once, into the channel', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  const posts = [];
  const channel = { send: async (p) => posts.push(p.content) };
  updateGuildGoals(guildId, () => ({ 'read-30-books': goalOf({ target: 100 }) }));

  const half = await moveGoal(guild, 'read-30-books', 60, { channel });
  assert.equal(half.ok, true);
  assert.deepEqual(half.crossed, [25, 50]);
  assert.equal(posts.length, 1, 'two marks in one jump is ONE piece of news');
  assert.match(posts[0], /\*\*50%\*\*/);

  // The announcement is recorded in the same write as the progress, so a
  // re-run cannot re-announce.
  await moveGoal(guild, 'read-30-books', 60, { channel });
  assert.equal(posts.length, 1);

  const missing = await moveGoal(guild, 'gone', 1, { channel });
  assert.equal(missing.ok, false);
});

test('announcements can be switched off without stopping the tracking', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  const posts = [];
  setGoalsConfig(guildId, { enabled: false });
  updateGuildGoals(guildId, () => ({ g: { ...goalOf({ target: 100 }), id: 'g' } }));

  const moved = await moveGoal(guild, 'g', 100, { channel: { send: async (p) => posts.push(p) } });
  assert.equal(moved.goal.current, 100, 'still tracked');
  assert.equal(posts.length, 0, 'just not announced');
});

test('the sweep updates only auto-tracked goals, and is quiet when nothing changed', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId, { memberCount: 640, boostCount: 3 });
  updateGuildGoals(guildId, () => ({
    'members-goal': { ...goalOf({ target: 1000 }), id: 'members-goal', name: 'Members goal', source: 'members' },
    'boost-goal': { ...goalOf({ target: 10 }), id: 'boost-goal', name: 'Boost goal', source: 'boosts' },
    'hand-goal': { ...goalOf({ target: 50 }), id: 'hand-goal', name: 'Hand goal', current: 12 },
  }));

  assert.equal(await refreshTrackedGoals(guild, { channel: null }), 2);
  const after1 = getGuildGoals(guildId);
  assert.equal(after1['members-goal'].current, 640);
  assert.equal(after1['boost-goal'].current, 3);
  assert.equal(after1['hand-goal'].current, 12, 'a hand-kept number is never overwritten');

  // Nothing changed on the guild → no writes, no announcements. This is what
  // makes a fifteen-minute sweep free.
  assert.equal(await refreshTrackedGoals(guild, { channel: null }), 0);
});

// ── the command surface ──────────────────────────────────────────────────────

const SUBS = goalCommand.group.subcommands;
const runGroup = (message, line) => dispatchGroup(goalCommand.group, message, tokenize(line), '!');

test('personal goals are public and precinct goals are Manage Server', () => {
  const open = SUBS.filter((s) => !s.permission).map((s) => s.name);
  assert.deepEqual(open, ['list', 'mine', 'new', 'log', 'done', 'drop', 'board']);
  const gated = SUBS.filter((s) => s.permission).map((s) => s.name);
  assert.deepEqual(gated, ['create', 'set', 'bump', 'track', 'remove', 'channel', 'announce', 'reset']);
  for (const sub of SUBS.filter((s) => s.permission)) {
    assert.equal(sub.permission, PermissionFlagsBits.ManageGuild, sub.name);
  }
});

/** fakeMessage's guild has no member/boost counts; the sweep reads both. */
function goalMessage(guildId, { authorId = ALICE, memberCount = 0, boostCount = 0 } = {}) {
  const message = fakeMessage({ guildId, authorId });
  message.guild.memberCount = memberCount;
  message.guild.premiumSubscriptionCount = boostCount;
  return message;
}

test('a member can run a goal from start to finish', async () => {
  const guildId = freshGuildId();
  const message = goalMessage(guildId);

  await runGroup(message, 'new 30 Read 30 books');
  assert.match(message.sent.at(-1).content, /Goal set: \*\*Read 30 books\*\* — 0 \/ 30/);

  await runGroup(message, 'log 12 books');
  assert.match(message.sent.at(-1).content, /12 \/ 30/);
  assert.equal(getMemberGoals(guildId, ALICE)['read-30-books'].current, 12);

  await runGroup(message, 'log 100 books');
  assert.match(message.sent.at(-1).content, /done!/);
  assert.equal(getMemberGoals(guildId, ALICE)['read-30-books'].current, 30, 'clamped, not 112');

  await runGroup(message, 'drop books');
  assert.deepEqual(getMemberGoals(guildId, ALICE), {});
});

test('!goal done finishes without counting, and a bad name is refused', async () => {
  const guildId = freshGuildId();
  const message = goalMessage(guildId);
  await runGroup(message, 'new 5 Fix the printer');
  await runGroup(message, 'done printer');
  assert.match(message.sent.at(-1).content, /reached/);
  assert.equal(isComplete(getMemberGoals(guildId, ALICE)['fix-the-printer']), true);

  await runGroup(message, 'log 1 nonexistent goal');
  assert.match(message.sent.at(-1).content, /No goal matches/);
});

test('the per-member limit is enforced', async () => {
  const guildId = freshGuildId();
  setGoalsConfig(guildId, { perMemberLimit: 2 });
  const message = goalMessage(guildId);
  await runGroup(message, 'new 1 One');
  await runGroup(message, 'new 1 Two');
  await runGroup(message, 'new 1 Three');
  assert.match(message.sent.at(-1).content, /already have \*\*2\*\* goals open/);
  assert.equal(Object.keys(getMemberGoals(guildId, ALICE)).length, 2);
});

test('an auto-tracked precinct goal shows its real number immediately', async () => {
  const guildId = freshGuildId();
  const message = goalMessage(guildId, { memberCount: 640 });
  // Sitting at 0 until the first sweep would make the feature look broken.
  await runGroup(message, 'create 1000 Members track:members');
  assert.match(message.sent.at(-1).content, /640 \/ 1000/);
  assert.equal(getGuildGoals(guildId).members.source, 'members');
});

test('a hand-set value is refused on an auto-tracked goal, with the fix named', async () => {
  const guildId = freshGuildId();
  const message = goalMessage(guildId, { memberCount: 640 });
  await runGroup(message, 'create 1000 Members track:members');
  await runGroup(message, 'set 999 Members');
  // Accepting it would look like it worked until the next sweep undid it.
  assert.match(message.sent.at(-1).content, /would be overwritten.*goal track manual/s);
  assert.equal(getGuildGoals(guildId).members.current, 640);

  await runGroup(message, 'track manual Members');
  await runGroup(message, 'set 999 Members');
  assert.equal(getGuildGoals(guildId).members.current, 999);
});

test('precinct goals can be bumped, listed and removed', async () => {
  const guildId = freshGuildId();
  const message = goalMessage(guildId);
  await runGroup(message, 'create 100 Cases closed unit:cases');
  await runGroup(message, 'bump 40 Cases');
  assert.equal(getGuildGoals(guildId)['cases-closed'].current, 40);

  await runGroup(message, 'list');
  const body = JSON.stringify(message.sent.at(-1).embeds[0]);
  assert.match(body, /Cases closed/);
  assert.match(body, /40 \/ 100 cases/);

  await runGroup(message, 'remove Cases');
  assert.deepEqual(getGuildGoals(guildId), {});
});

test('reset needs the word, and then takes everything', async () => {
  const guildId = freshGuildId();
  const message = goalMessage(guildId);
  await runGroup(message, 'create 10 Precinct thing');
  await runGroup(message, 'new 10 Personal thing');

  await runGroup(message, 'reset');
  assert.match(message.sent.at(-1).content, /Run `!goal reset confirm`/);
  assert.equal(Object.keys(getGuildGoals(guildId)).length, 1, 'nothing deleted');

  await runGroup(message, 'reset confirm');
  assert.deepEqual(getGuildGoals(guildId), {});
  assert.deepEqual(getMemberGoals(guildId, ALICE), {}, 'personal goals go too — the reply says so');
});

test('the board and the status card read from both halves', async () => {
  const guildId = freshGuildId();
  const message = goalMessage(guildId);
  await runGroup(message, 'new 1 Done thing');
  await runGroup(message, 'done Done thing');
  await runGroup(message, 'new 5 Open thing');

  await runGroup(message, 'board');
  assert.match(JSON.stringify(message.sent.at(-1).embeds[0]), /🥇 <@800000000000000001> — \*\*1\*\* reached/);

  await runGroup(message, '');
  const status = JSON.stringify(message.sent.at(-1).embeds[0]);
  assert.match(status, /Your goals:\*\* 1 open, 1 reached/);
  assert.match(status, /Precinct goals:\*\* 0 open/);
});
