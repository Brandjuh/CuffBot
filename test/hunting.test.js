import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  CROOKS,
  DEFAULT_HUNTING_CONFIG,
  addCatch,
  fumbles,
  isSalute,
  nextSpawnDelayMs,
  pickCrook,
  resolveShout,
  rollReward,
} from '../src/modules/hunting/lib/hunt.js';
import {
  activeHunt,
  escapeCrook,
  getHuntingConfig,
  getScores,
  huntingAvailable,
  noteMessage,
  recordCatch,
  resetHuntingState,
  resolveHunt,
  setHuntingConfig,
  spawnCrook,
  topHunters,
} from '../src/modules/hunting/service.js';
import { balanceOf, getPot } from '../src/modules/economy/service.js';
// S106: `!hunt-stats` / `!hunt-board` are `!hunting stats` / `board`.
import huntingGroup from '../src/modules/hunting/commands/hunting.js';
import { dispatchCommand } from '../src/core/prefix/command.js';
import { dispatchGroup } from '../src/core/prefix/group.js';
import { fakeMessage, fakeUser } from './fixtures/fake-message.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-hunting-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});
beforeEach(() => resetHuntingState());

let seq = 0;
const freshGuildId = () => `80000000000000${String((seq += 1)).padStart(4, '0')}`;
const HUNTER = '700000000000000031';
const RIVAL = '700000000000000032';

// ── pure rules ───────────────────────────────────────────────────────────────

test('the owner hunt channel is the committed default (S56 carried into S66)', () => {
  assert.deepEqual(DEFAULT_HUNTING_CONFIG.channels, ['412354971170897921']);
  assert.equal(DEFAULT_HUNTING_CONFIG.intervalMinS, 900, 'vrt default');
  assert.equal(DEFAULT_HUNTING_CONFIG.intervalMaxS, 3600, 'vrt default');
  assert.equal(DEFAULT_HUNTING_CONFIG.catchTimeoutS, 20, 'vrt default');
  assert.equal(DEFAULT_HUNTING_CONFIG.mode, 'words');
});

test('pickCrook draws from the board; undercover officer only when enabled', () => {
  assert.equal(CROOKS.length, 8);
  const undercover = CROOKS.findIndex((c) => c.undercover);
  assert.ok(undercover >= 0, 'the undercover officer is on the board');
  const picked = pickCrook(() => undercover / CROOKS.length, { undercover: true });
  assert.equal(picked.undercover, true);
  for (let i = 0; i < CROOKS.length; i += 1) {
    const crook = pickCrook(() => i / CROOKS.length, { undercover: false });
    assert.ok(!crook.undercover, 'never the officer when the special is off');
  }
});

test('the fumble roll is exactly 2/17, byte-faithful to the cog', () => {
  assert.equal(fumbles(() => 0), true, 'randrange 0 fumbles');
  assert.equal(fumbles(() => 1.9 / 17), true, 'randrange 1 fumbles');
  assert.equal(fumbles(() => 2.1 / 17), false, 'randrange 2 hits');
  assert.equal(fumbles(() => 0.999), false);
});

test('nextSpawnDelayMs spans [min, max] seconds inclusive and survives typos', () => {
  const config = { intervalMinS: 900, intervalMaxS: 3600 };
  assert.equal(nextSpawnDelayMs(config, () => 0), 900_000);
  assert.equal(nextSpawnDelayMs(config, () => 0.99999), 3_600_000);
  assert.equal(nextSpawnDelayMs({ intervalMinS: 5, intervalMaxS: 3 }, () => 0), 60_000, 'floored at 60 s, max>=min');
});

test('isSalute: the 🫡 emoji or the word salute', () => {
  assert.equal(isSalute('🫡'), true);
  assert.equal(isSalute('I salute you, officer'), true);
  assert.equal(isSalute('salutes'), true);
  assert.equal(isSalute('STOP POLICE'), false);
  assert.equal(isSalute('absolute'), false, 'no substring match');
});

test('resolveShout matrix: catch/salute × crook/officer × fumble', () => {
  const crook = CROOKS.find((c) => !c.undercover);
  const officer = CROOKS.find((c) => c.undercover);
  const hit = () => 0.999; // no fumble
  const fumble = () => 0; // fumble
  assert.equal(resolveShout(crook, 'catch', hit), 'caught');
  assert.equal(resolveShout(crook, 'catch', fumble), 'fumbled');
  assert.equal(resolveShout(crook, 'salute', hit), 'ignored', 'only the officer wants a salute');
  assert.equal(resolveShout(officer, 'salute', hit), 'saluted');
  assert.equal(resolveShout(officer, 'catch', hit), 'cuffed-colleague');
  assert.equal(resolveShout(officer, 'catch', fumble), 'fumbled');
});

test('rollReward stays inside the configured range; addCatch accumulates', () => {
  assert.equal(rollReward({ rewardMin: 100, rewardMax: 300 }, () => 0), 100);
  assert.equal(rollReward({ rewardMin: 100, rewardMax: 300 }, () => 0.999), 300);
  const record = addCatch(addCatch(undefined, 'burglar'), 'burglar');
  assert.deepEqual(record, { total: 2, byCrook: { burglar: 2 } });
});

// ── service on a fake guild ──────────────────────────────────────────────────

function fakeGuild(guildId, { channelId = '412354971170897921', memberIds = [], messageContent = true } = {}) {
  const sends = [];
  const channel = {
    id: channelId,
    sends,
    send: async (p) => (sends.push(p), { id: `m${sends.length}`, react: async () => {} }),
  };
  const guild = {
    id: guildId,
    channels: { cache: new Map([[channelId, channel]]) },
    members: {
      cache: new Map(memberIds.map((id) => [id, { id, user: { bot: false }, displayName: `name-${id}` }])),
      fetch: async () => null,
    },
  };
  channel.guild = guild;
  guild.client = { config: { homeGuildId: guildId }, messageContentAvailable: messageContent };
  return { guild, channel, sends };
}

const fakeMember = (id) => ({ id, displayName: `officer-${id}`, user: { username: `u-${id}` } });

test('the vrt scheduler: arm → wait → schedule; busy and off channels refuse', () => {
  const guildId = freshGuildId();
  const { guild, channel } = fakeGuild(guildId);
  const message = { guild, channel, client: guild.client };

  assert.equal(noteMessage(message, { now: 1000, random: () => 0 }), 'armed', 'first message arms the clock');
  assert.equal(noteMessage(message, { now: 2000, random: () => 0 }), 'waiting', 'clock not elapsed yet');
  const scheduled = noteMessage(message, { now: 1000 + 900_000 + 1, random: () => 0 });
  assert.equal(scheduled, 'scheduled', 'past the clock — the crook is on the way');
  assert.equal(noteMessage(message, { now: 1000 + 900_001, random: () => 0 }), 'busy', 'one pending spawn per channel');

  const foreign = { guild, channel: { id: 'other-chan' }, client: guild.client };
  assert.equal(noteMessage(foreign, { now: 1 }), 'off', 'not an enabled channel');
});

test('words mode without Message Content is unavailable; reaction mode works (S38 rule)', () => {
  const guildId = freshGuildId();
  const { guild, channel } = fakeGuild(guildId, { messageContent: false });
  const message = { guild, channel, client: guild.client };
  assert.equal(noteMessage(message, { now: 1 }), 'unavailable');
  setHuntingConfig(guildId, { mode: 'reaction' });
  assert.equal(huntingAvailable(guild.client, getHuntingConfig(guildId)), true);
  assert.equal(noteMessage(message, { now: 1 }), 'armed');
});

test('spawn → STOP POLICE catch pays, records the score, closes the hunt', async () => {
  const guildId = freshGuildId();
  const { guild, channel, sends } = fakeGuild(guildId);
  const crook = CROOKS.find((c) => c.id === 'burglar');
  const hunt = await spawnCrook(channel, { crook, now: 1000 });
  assert.ok(hunt && activeHunt(channel.id), 'hunt open');
  assert.match(sends[0].content, /Just passing through/);

  const outcome = await resolveHunt(channel, fakeMember('cop'), 'catch', { random: () => 0.999, now: 2000 });
  assert.equal(outcome, 'caught');
  assert.equal(activeHunt(channel.id), null, 'hunt closed');
  assert.equal(balanceOf(guildId, 'cop'), 10_300, '10k start + max-roll 300 bounty');
  assert.deepEqual(getScores(guildId).cop, { total: 1, byCrook: { burglar: 1 } });
  assert.match(sends.at(-1).content, /GOTCHA/);
});

test('cuffing the undercover officer fines into the pot; saluting pays (S66)', async () => {
  const guildId = freshGuildId();
  const { guild, channel, sends } = fakeGuild(guildId);
  const officer = CROOKS.find((c) => c.undercover);

  await spawnCrook(channel, { crook: officer, now: 1000 });
  const bad = await resolveHunt(channel, fakeMember('rambo'), 'catch', { random: () => 0.999, now: 1500 });
  assert.equal(bad, 'cuffed-colleague');
  assert.equal(balanceOf(guildId, 'rambo'), 10_000 - 300, 'max-roll fine paid');
  assert.equal(getPot(guildId).balance, 500 + 300, 'daily seed + the fine');
  assert.match(sends.at(-1).content, /UNDERCOVER OFFICER/);

  await spawnCrook(channel, { crook: officer, now: 2000 });
  const good = await resolveHunt(channel, fakeMember('polite'), 'salute', { random: () => 0.999, now: 2500 });
  assert.equal(good, 'saluted');
  assert.equal(balanceOf(guildId, 'polite'), 10_300);
});

test('a fumble ends the hunt without pay; a salute at a normal crook is ignored', async () => {
  const guildId = freshGuildId();
  const { guild, channel } = fakeGuild(guildId);
  const crook = CROOKS.find((c) => c.id === 'smuggler');
  await spawnCrook(channel, { crook, now: 1000 });

  assert.equal(await resolveHunt(channel, fakeMember('x'), 'salute', { now: 1200 }), 'ignored');
  assert.ok(activeHunt(channel.id), 'the hunt stays open after an ignored salute');

  const outcome = await resolveHunt(channel, fakeMember('x'), 'catch', { random: () => 0, now: 1300 });
  assert.equal(outcome, 'fumbled');
  assert.equal(balanceOf(guildId, 'x'), 10_000, 'no bounty on a fumble');
  assert.equal(activeHunt(channel.id), null);
});

test('an escaped crook pickpockets a member into the pot; the officer just leaves', async () => {
  const guildId = freshGuildId();
  const { guild, channel, sends } = fakeGuild(guildId, { memberIds: ['victim'] });
  const crook = CROOKS.find((c) => c.id === 'pickpocket');
  await escapeCrook(channel, crook, { random: () => 0 });
  assert.match(sends.at(-1).content, /got away/);
  assert.equal(balanceOf(guildId, 'victim'), 10_000 - 50, 'min-roll 50 stolen');
  assert.equal(getPot(guildId).balance, 500 + 50);
  assert.deepEqual(sends.at(-1).allowedMentions, { parse: [] });

  const officer = CROOKS.find((c) => c.undercover);
  await escapeCrook(channel, officer, { random: () => 0 });
  assert.match(sends.at(-1).content, /slipped back into the crowd/);
  assert.equal(getPot(guildId).balance, 550, 'the officer steals nothing');
});

test('topHunters ranks by total catches', async () => {
  const guildId = freshGuildId();
  const { channel } = fakeGuild(guildId);
  const crook = CROOKS.find((c) => c.id === 'mob-boss');
  for (const [id, catches] of [['a', 1], ['b', 3], ['c', 2]]) {
    for (let i = 0; i < catches; i += 1) {
      await spawnCrook(channel, { crook, now: 1000 + i });
      await resolveHunt(channel, fakeMember(id), 'catch', { random: () => 0.999, now: 1001 + i });
    }
  }
  assert.deepEqual(topHunters(guildId, 3).map((r) => r.userId), ['b', 'c', 'a']);
});

// ── the two flat commands (converted in S93 = M17.3 slice A) ─────────────────
// Neither had a test before the conversion; writing them was part of it.

test('!hunt-stats reports a hunter’s catches per crook type', async () => {
  const guildId = freshGuildId();
  const hunter = fakeUser(HUNTER, 'hunter');
  recordCatch(guildId, HUNTER, 'mob-boss');
  recordCatch(guildId, HUNTER, 'mob-boss');
  recordCatch(guildId, HUNTER, 'pickpocket');

  const message = fakeMessage({ guildId, authorId: HUNTER, users: { [HUNTER]: hunter } });
  assert.equal(await dispatchGroup(huntingGroup.group, message, ['stats', ...[]], '!'), 'ran');
  const desc = message.sent[0].embeds[0].data.description;
  assert.match(desc, /\*\*3\*\* crooks cuffed in total/);
  assert.match(desc, /mob boss — \*\*2\*\*/);
  assert.match(desc, /pickpocket — \*\*1\*\*/);
});

test('!hunt-stats tells an empty-handed hunter how to start', async () => {
  const message = fakeMessage({ guildId: freshGuildId(), authorId: HUNTER });
  await dispatchGroup(huntingGroup.group, message, ['stats', ...[]], '!');
  assert.match(message.sent[0].content, /Cuff a crook before you brag/);
});

test('!hunt-board ranks the precinct and opens with a gold medal', async () => {
  const guildId = freshGuildId();
  for (const [id, catches] of [[HUNTER, 1], [RIVAL, 3]]) {
    for (let i = 0; i < catches; i += 1) recordCatch(guildId, id, 'mob-boss');
  }
  const message = fakeMessage({ guildId, authorId: HUNTER });
  await dispatchGroup(huntingGroup.group, message, ['board', ...[]], '!');
  const desc = message.sent[0].embeds[0].data.description;
  assert.ok(desc.indexOf(RIVAL) < desc.indexOf(HUNTER), 'three catches outrank one');
  assert.match(desc, /🥇/);
});

test('!hunt-board says the board is open when nobody has scored', async () => {
  const message = fakeMessage({ guildId: freshGuildId(), authorId: HUNTER });
  await dispatchGroup(huntingGroup.group, message, ['board', ...[]], '!');
  assert.match(message.sent[0].content, /the board is wide open/);
});
