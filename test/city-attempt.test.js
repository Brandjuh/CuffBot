// M26.3b: the narrated attempt end to end.
//
// The pure script is tested in city-narrate.test.js. What is asserted here is
// the thing the player actually experiences: the message is edited once per
// beat, the bail flag is honoured BETWEEN beats rather than only at the start,
// and the events narrated are the same events the outcome was computed from.
//
// `wait` is injected, so a 24-second bank job runs in zero milliseconds.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-city-attempt-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const { attemptFromPanel, boardPayload, marketPayload, targetCandidates } = await import(
  '../src/modules/city/commands/crime.js'
);
const { getAttempt } = await import('../src/modules/city/attempts.js');
const { cityBalance, getCriminal, updateCriminal } = await import('../src/modules/city/service.js');
const { adjustBalance } = await import('../src/modules/economy/service.js');
const { crimeEvents } = await import('../src/modules/city/lib/tables.js');

let seq = 0;
const freshGuildId = () => `91000000000000${String((seq += 1)).padStart(4, '0')}`;

/**
 * A fake interaction that records every payload it is handed.
 *
 * `onBeat` runs after each edit, which is how a test presses Bail Out "during"
 * the narration without a real clock.
 */
function fakeInteraction(guildId, userId, { onBeat = () => {} } = {}) {
  const edits = [];
  const replies = [];
  const messageId = `${guildId}-msg`;
  let beat = 0;
  const interaction = {
    guild: { id: guildId, members: { cache: new Map() } },
    user: { id: userId, username: 'crook' },
    member: { displayName: 'Crook' },
    message: { id: messageId },
    edits,
    replies,
    messageId,
    reply: async (payload) => {
      replies.push(payload);
      edits.push(payload);
      return { id: messageId };
    },
    editReply: async (payload) => {
      edits.push(payload);
      beat += 1;
      onBeat(beat, interaction);
      return { id: messageId };
    },
    fetchReply: async () => ({ id: messageId }),
  };
  return interaction;
}

const noWait = async () => {};
const describe = (payload) => payload?.embeds?.[0]?.data?.description ?? '';
const titleOf = (payload) => payload?.embeds?.[0]?.data?.title ?? '';

/** Deterministic rng: always the first option, always a success roll. */
const winningRng = { int: (min) => min, float: () => 0, uniform: (a) => a, pick: (list) => list[0] };

/**
 * Deterministic but NOT repeating: each `pick` advances, so a second draw
 * yields different events from the first.
 *
 * ⚠️ `winningRng` cannot detect a double draw — picking index 0 twice returns
 * the same events both times, which is exactly how the first version of the
 * "same events" test below passed against code that drew twice. A test for
 * "these two things came from one source" needs a source that can tell them
 * apart.
 */
function walkingRng() {
  let n = 0;
  return {
    int: (min) => min,
    float: () => 0,
    uniform: (a) => a,
    pick: (list) => list[(n += 1) % list.length],
  };
}

async function rich(guildId, userId, amount = 10_000) {
  await adjustBalance(guildId, userId, amount);
}

// ── the narration ────────────────────────────────────────────────────────────

test('the attempt is edited once per beat, not resolved in one shot', async () => {
  const guildId = freshGuildId();
  await rich(guildId, '10');
  const interaction = fakeInteraction(guildId, '10');
  await attemptFromPanel(interaction, 'rob_store', { wait: noWait, rng: winningRng });

  // opening reply + one edit per remaining beat + the verdict.
  assert.ok(interaction.edits.length >= 3, `only ${interaction.edits.length} renders`);
  assert.match(titleOf(interaction.edits.at(-1)), /Clean getaway|Caught/, 'the last render is the result card');
});

test('the events shown while it plays are the events the outcome used', async () => {
  // Drawing twice would mean the story the player watched and the outcome they
  // got came from different crimes. Both surfaces render an event as
  // "• <formatted text>", so the two lists must match exactly.
  const guildId = freshGuildId();
  await rich(guildId, '11');
  const interaction = fakeInteraction(guildId, '11');
  await attemptFromPanel(interaction, 'rob_store', { wait: noWait, rng: walkingRng() });

  const bullets = (payload) =>
    describe(payload)
      .split('\n')
      .filter((line) => line.startsWith('• '));

  const narrated = bullets(interaction.edits.at(-2));
  const onTheCard = bullets(interaction.edits.at(-1));
  assert.ok(narrated.length > 0, 'at least one event was narrated');
  assert.deepEqual(onTheCard, narrated, 'the result card lists a different set of events than was narrated');
  assert.equal(narrated.length, crimeEvents().rob_store.length >= 4 ? 4 : narrated.length, 'all four were drawn');
});

test('every beat before the verdict still carries the Bail Out offer', async () => {
  const guildId = freshGuildId();
  await rich(guildId, '12');
  const interaction = fakeInteraction(guildId, '12');
  await attemptFromPanel(interaction, 'bank_heist', { wait: noWait, rng: winningRng });

  const beats = interaction.edits.slice(0, -1);
  for (const [i, payload] of beats.entries()) {
    assert.match(describe(payload), /Bail Out/, `beat ${i} lost the offer`);
    assert.equal(payload.components.length, 1, `beat ${i} lost its button`);
  }
  assert.deepEqual(interaction.edits.at(-1).components, [], 'the result card has no live buttons');
});

// ── bailing out mid-narration: the point of the slice ────────────────────────

test('bailing out during the narration stops it — the money never moves', async () => {
  const guildId = freshGuildId();
  await rich(guildId, '13', 5_000);
  const before = getCriminal(guildId, '13');

  // Press Bail Out after the second beat, exactly as the button's handler does.
  const interaction = fakeInteraction(guildId, '13', {
    onBeat(n, self) {
      if (n === 2) {
        const live = getAttempt(self.messageId);
        if (live) live.bailed = true;
      }
    },
  });
  await attemptFromPanel(interaction, 'bank_heist', { wait: noWait, rng: winningRng });

  const after_ = getCriminal(guildId, '13');
  assert.equal(after_.stats.successes, before.stats.successes, 'no success was recorded');
  assert.equal(after_.stats.failures, before.stats.failures, 'no failure was recorded');
  assert.equal(after_.lastCrimeAt, before.lastCrimeAt, 'the crime never happened');
  assert.doesNotMatch(titleOf(interaction.edits.at(-1)), /Clean getaway|Caught/, 'no result card was posted');
});

test('bailing at the LAST beat still stops it — the window is not just the opening', async () => {
  // S122 could only honour a bail in the first 2 seconds. This is the
  // regression that would put us back there.
  const guildId = freshGuildId();
  await rich(guildId, '14', 5_000);
  const before = getCriminal(guildId, '14');
  let beats = 0;

  const counting = fakeInteraction(guildId, '14', { onBeat: () => { beats += 1; } });
  await attemptFromPanel(counting, 'rob_store', { wait: noWait, rng: winningRng });
  const total = beats;
  assert.ok(total >= 2, 'the crime has more than one beat to bail on');

  const guild2 = freshGuildId();
  await rich(guild2, '14', 5_000);
  const late = fakeInteraction(guild2, '14', {
    onBeat(n, self) {
      if (n === total - 1) {
        const live = getAttempt(self.messageId);
        if (live) live.bailed = true;
      }
    },
  });
  await attemptFromPanel(late, 'rob_store', { wait: noWait, rng: winningRng });
  assert.equal(getCriminal(guild2, '14').lastCrimeAt, before.lastCrimeAt, 'a late bail still counts');
});

test('not bailing lets the crime settle, so the guard above is not vacuous', async () => {
  const guildId = freshGuildId();
  await rich(guildId, '15', 5_000);
  const interaction = fakeInteraction(guildId, '15');
  await attemptFromPanel(interaction, 'rob_store', { wait: noWait, rng: winningRng });
  assert.notEqual(getCriminal(guildId, '15').lastCrimeAt, 0, 'the crime did happen');
});

// ── the target picker ────────────────────────────────────────────────────────

test('a targeted crime with no mark opens the picker instead of citing a command', async () => {
  const guildId = freshGuildId();
  await rich(guildId, '16');
  const interaction = fakeInteraction(guildId, '16');
  await attemptFromPanel(interaction, 'pickpocket', { wait: noWait, rng: winningRng });

  const shown = interaction.edits.at(-1);
  assert.match(titleOf(shown), /pick a mark/i);
  assert.doesNotMatch(describe(shown), /!crime/, 'the panel must not send the player back to text commands');
  assert.equal(shown.components.length, 2, 'a user select and the Random/Cancel row');
});

test('a targeted crime WITH a mark runs, and the victim is remembered', async () => {
  const guildId = freshGuildId();
  await rich(guildId, '17');
  await rich(guildId, '99', 5_000);
  const interaction = fakeInteraction(guildId, '17');
  await attemptFromPanel(interaction, 'pickpocket', { wait: noWait, rng: winningRng, targetId: '99' });

  assert.match(titleOf(interaction.edits.at(-1)), /Clean getaway|Caught/);
  assert.equal(getCriminal(guildId, '17').lastTargetId, '99', 'the roller needs to know who was just hit');
});

test('candidate gathering skips bots and yourself before it reads a single balance', async () => {
  const guildId = freshGuildId();
  const guild = {
    id: guildId,
    members: {
      cache: new Map([
        ['1', { id: '1', displayName: 'me', user: { bot: false, username: 'me' } }],
        ['2', { id: '2', displayName: 'bot', user: { bot: true, username: 'bot' } }],
        ['3', { id: '3', displayName: 'mark', user: { bot: false, username: 'mark' } }],
      ]),
    },
  };
  const candidates = await targetCandidates(guild, '1');
  assert.deepEqual(candidates.map((c) => c.id), ['3']);
  assert.equal(typeof candidates[0].balance, 'number');
  assert.equal(candidates[0].jailed, false);
});

test('the shortlist is capped, so one button press cannot read a whole guild', async () => {
  const guildId = freshGuildId();
  const cache = new Map();
  for (let i = 0; i < 200; i += 1) {
    cache.set(String(i), { id: String(i), displayName: `m${i}`, user: { bot: false, username: `m${i}` } });
  }
  const candidates = await targetCandidates({ id: guildId, members: { cache } }, 'nobody', { limit: 25 });
  assert.equal(candidates.length, 25);
});

test('a jailed member is reported as jailed, so the roller can skip them', async () => {
  const guildId = freshGuildId();
  updateCriminal(guildId, '5', (c) => ({ ...c, jailMs: 60 * 60_000, jailStartedAt: Date.now() }));
  const guild = {
    id: guildId,
    members: { cache: new Map([['5', { id: '5', displayName: 'inside', user: { bot: false } }]]) },
  };
  const [candidate] = await targetCandidates(guild, 'nobody');
  assert.equal(candidate.jailed, true);
});

// ── market and board, in the panel ───────────────────────────────────────────

const rowKind = (row) => row.components[0].data.custom_id.split(':')[1];

test('the market panel sells in one press instead of citing !crime buy', async () => {
  const guildId = freshGuildId();
  await rich(guildId, '20', 50_000);
  const payload = await marketPayload({ id: guildId }, { id: '20' });

  assert.deepEqual(payload.components.map(rowKind), ['buy', 'refresh'], 'a buy menu and a way back');
  assert.doesNotMatch(payload.embeds[0].data.footer?.text ?? '', /crime buy/, 'the select IS the buy step');
  assert.equal(payload.components[0].components[0].data.disabled, false, 'a rich player can buy');
});

test('a broke player gets a dead menu rather than a refusal after the fact', async () => {
  // Everyone starts on the economy's 10,000 opening balance, which already
  // covers the jail pass — so "broke" has to be made, not assumed. (The first
  // version of this test assumed an unfunded member was poor and failed.)
  const guildId = freshGuildId();
  await adjustBalance(guildId, '21', -(await cityBalance(guildId, '21')));
  const payload = await marketPayload({ id: guildId }, { id: '21' });
  assert.equal(payload.components[0].components[0].data.disabled, true);
});

test('the market names what you already own, so the shelf reflects your record', async () => {
  const guildId = freshGuildId();
  await rich(guildId, '22', 50_000);
  updateCriminal(guildId, '22', (c) => ({ ...c, perks: ['jail_reducer'] }));
  const payload = await marketPayload({ id: guildId }, { id: '22' });
  assert.match(payload.embeds[0].data.description, /\*\*owned\*\*/);
});

test('the board switches category in place and marks the one you are on', () => {
  const guildId = freshGuildId();
  const payload = boardPayload({ id: guildId }, { id: '30' }, 'jobs');
  assert.match(payload.embeds[0].data.title, /Successful jobs/);
  assert.deepEqual(payload.components.map(rowKind), ['board-cat', 'refresh']);
  const options = payload.components[0].components[0].options;
  assert.equal(options.filter((o) => o.data.default).length, 1, 'exactly one category is current');
  assert.equal(options.find((o) => o.data.default).data.value, 'jobs');
});

test('an unknown category falls back rather than rendering an empty board', () => {
  const payload = boardPayload({ id: freshGuildId() }, { id: '31' }, 'nonsense');
  assert.match(payload.embeds[0].data.title, /Total earned/);
});

test('an empty board says so instead of showing a blank embed', () => {
  const payload = boardPayload({ id: freshGuildId() }, { id: '32' });
  assert.match(payload.embeds[0].data.description, /Nobody has a record/);
});
