import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_ECONOMY_CONFIG,
  channelIsActive,
  earnGain,
  huntDurationMs,
  isCatchPhrase,
  pickVictim,
  randomInt,
  shouldSpawnHunt,
  trackActivity,
} from '../src/modules/economy/lib/bank.js';
import {
  activeHunt,
  addToPot,
  adjustBalance,
  attemptHeist,
  awardActivity,
  balanceOf,
  getAccounts,
  getPot,
  grantBirthdayBonus,
  resetHuntState,
  resolveCatch,
  setEconomyConfig,
  spawnHunt,
  topBalances,
  tryPot,
} from '../src/modules/economy/service.js';
import economyWatch from '../src/modules/economy/events/economy-watch.js';
import { sweepBirthdays, setBirthday } from '../src/modules/birthdays/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-economy-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});
beforeEach(() => resetHuntState());

let seq = 0;
const freshGuildId = () => `40000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── pure rules ───────────────────────────────────────────────────────────────

test('activity pay honors the cooldown', () => {
  const config = DEFAULT_ECONOMY_CONFIG;
  assert.equal(earnGain(config, null, 1_000), 5);
  assert.equal(earnGain(config, 1_000, 30_000), 0, 'inside the 60 s cooldown');
  assert.equal(earnGain(config, 1_000, 61_001), 5);
});

test('randomInt spans the whole inclusive range', () => {
  assert.equal(randomInt(5, 20, () => 0), 5);
  assert.equal(randomInt(5, 20, () => 0.999999), 20);
  const duration = huntDurationMs(DEFAULT_ECONOMY_CONFIG, () => 0.5);
  assert.ok(duration >= 5_000 && duration <= 20_000, 'the crook lingers 5–20 s');
});

test('channel activity: enough recent messages from at least two humans', () => {
  const state = new Map();
  const now = 100_000;
  for (let i = 0; i < 4; i += 1) trackActivity(state, 'c1', 'solo', now + i, DEFAULT_ECONOMY_CONFIG);
  assert.equal(channelIsActive(state, 'c1', now + 10, DEFAULT_ECONOMY_CONFIG), false, 'one voice is a monologue');
  trackActivity(state, 'c1', 'other', now + 5, DEFAULT_ECONOMY_CONFIG);
  assert.equal(channelIsActive(state, 'c1', now + 10, DEFAULT_ECONOMY_CONFIG), true);
  // Stale messages age out of the window.
  assert.equal(channelIsActive(state, 'c1', now + 10 + 3 * 60_000, DEFAULT_ECONOMY_CONFIG), false);
});

test('spawn roll: needs activity, respects per-channel cooldown and chance', () => {
  const config = DEFAULT_ECONOMY_CONFIG;
  const base = { active: true, lastHuntAt: null, now: 1_000_000, config };
  assert.equal(shouldSpawnHunt({ ...base, random: () => 0.999 }), false, 'unlucky roll');
  assert.equal(shouldSpawnHunt({ ...base, random: () => 0.0001 }), true, 'lucky roll');
  assert.equal(shouldSpawnHunt({ ...base, active: false, random: () => 0 }), false, 'quiet channel');
  assert.equal(
    shouldSpawnHunt({ ...base, lastHuntAt: base.now - 60_000, random: () => 0 }),
    false,
    'cooldown blocks back-to-back hunts',
  );
});

test('STOP POLICE matching is forgiving but must lead the message', () => {
  assert.equal(isCatchPhrase('STOP POLICE'), true);
  assert.equal(isCatchPhrase('stop police!!!'), true);
  assert.equal(isCatchPhrase('Stop, Police! You are under arrest'), true);
  assert.equal(isCatchPhrase('  sToP   pOlIcE  '), true);
  assert.equal(isCatchPhrase('stop the police'), false);
  assert.equal(isCatchPhrase('please stop police'), false, 'the shout must come first');
  assert.equal(isCatchPhrase(''), false);
});

test('pickVictim picks from candidates, null when there are none', () => {
  assert.equal(pickVictim([], () => 0), null);
  assert.equal(pickVictim(['a', 'b', 'c'], () => 0.5), 'b');
});

// ── balances ─────────────────────────────────────────────────────────────────

test('everyone starts at 10k; records materialize only on writes', () => {
  const guildId = freshGuildId();
  assert.equal(balanceOf(guildId, 'fresh'), 10_000);
  assert.equal(getAccounts(guildId).fresh, undefined, 'a read never writes');
  const { balance } = adjustBalance(guildId, 'fresh', -2_000);
  assert.equal(balance, 8_000, 'the first write starts from 10k');
});

test('balances never drop below zero; applied reports the real movement', () => {
  const guildId = freshGuildId();
  adjustBalance(guildId, 'poor', -9_950); // 10_000 → 50
  const result = adjustBalance(guildId, 'poor', -200);
  assert.equal(result.balance, 0);
  assert.equal(result.applied, -50, 'the crook can only steal what exists');
});

test('activity pay: cooldown-gated, no write inside the cooldown', () => {
  const guildId = freshGuildId();
  assert.equal(awardActivity(guildId, 'chatter', 1_000).gained, 5);
  assert.equal(awardActivity(guildId, 'chatter', 2_000).gained, 0);
  assert.equal(awardActivity(guildId, 'chatter', 62_000).gained, 5);
  assert.equal(balanceOf(guildId, 'chatter'), 10_010);
});

test('topBalances ranks the richest first', () => {
  const guildId = freshGuildId();
  adjustBalance(guildId, 'a', 500);
  adjustBalance(guildId, 'b', 2_000);
  adjustBalance(guildId, 'c', -100);
  assert.deepEqual(
    topBalances(guildId, 3).map((r) => r.userId),
    ['b', 'a', 'c'],
  );
});

test('birthday bonus: 50k donuts, refused when the economy is disabled', () => {
  const guildId = freshGuildId();
  assert.equal(grantBirthdayBonus(guildId, 'bday'), 50_000);
  assert.equal(balanceOf(guildId, 'bday'), 60_000);
  setEconomyConfig(guildId, { enabled: false });
  assert.equal(grantBirthdayBonus(guildId, 'bday2'), null);
  assert.equal(getAccounts(guildId).bday2, undefined);
});

// ── /steal (the heist) ───────────────────────────────────────────────────────

test('heist success (30% roll): 500 donuts move victim → thief', () => {
  const guildId = freshGuildId();
  const guild = { id: guildId, ownerId: 'brandjuh' };
  const result = attemptHeist(guild, 'thief', 'victim', { random: () => 0.29, now: 1_000_000 });
  assert.equal(result.code, 'success');
  assert.equal(result.amount, 500);
  assert.equal(balanceOf(guildId, 'thief'), 10_500);
  assert.equal(balanceOf(guildId, 'victim'), 9_500);
});

test('heist failure (roll ≥ 0.3): the thief’s 500 land in the donut pot (S41)', () => {
  const guildId = freshGuildId();
  const guild = { id: guildId, ownerId: 'brandjuh' };
  const result = attemptHeist(guild, 'thief', 'victim', { random: () => 0.3, now: 1_000_000 });
  assert.equal(result.code, 'failure');
  assert.equal(result.amount, 500);
  assert.equal(result.potBalance, 1_000, "today's 500 top-up + the confiscated 500");
  assert.equal(balanceOf(guildId, 'thief'), 9_500);
  assert.equal(getPot(guildId, 1_000_000).balance, 1_000);
  assert.equal(balanceOf(guildId, 'victim'), 10_000, 'the target loses nothing on a failed attempt');
  assert.equal(balanceOf(guildId, 'brandjuh'), 10_000, 'S41: the chief no longer collects — the pot does');
});

test('heist amounts are honest when the payer is nearly broke', () => {
  const guildId = freshGuildId();
  const guild = { id: guildId, ownerId: 'brandjuh' };
  adjustBalance(guildId, 'poorvictim', -9_800); // 200 left
  const result = attemptHeist(guild, 'thief', 'poorvictim', { random: () => 0, now: 1_000_000 });
  assert.equal(result.amount, 200, 'you can only steal what they carry');
  assert.equal(balanceOf(guildId, 'thief'), 10_200);
  assert.equal(balanceOf(guildId, 'poorvictim'), 0);
});

test('heist cooldown: one attempt per 3-hour lay-low window (S48), stamped on both outcomes', () => {
  const guildId = freshGuildId();
  const guild = { id: guildId, ownerId: 'brandjuh' };
  const HOUR = 60 * 60_000;
  assert.equal(attemptHeist(guild, 'thief', 'v1', { random: () => 0.9, now: 1_000_000 }).code, 'failure');
  const blocked = attemptHeist(guild, 'thief', 'v2', { random: () => 0, now: 1_000_000 + HOUR });
  assert.equal(blocked.code, 'cooldown');
  assert.equal(blocked.waitMs, 2 * HOUR, '3-hour window minus the hour already served');
  const later = attemptHeist(guild, 'thief', 'v2', { random: () => 0, now: 1_000_000 + 3 * HOUR });
  assert.equal(later.code, 'success');
});

test('heist guards: self-theft and disabled economy refuse without stamping', () => {
  const guildId = freshGuildId();
  const guild = { id: guildId, ownerId: 'brandjuh' };
  assert.equal(attemptHeist(guild, 'me', 'me', { now: 1_000_000 }).code, 'self');
  setEconomyConfig(guildId, { enabled: false });
  assert.equal(attemptHeist(guild, 'me', 'other', { now: 1_000_000 }).code, 'disabled');
  assert.equal(getAccounts(guildId).me, undefined, 'refusals write nothing');
});

// ── the donut pot ────────────────────────────────────────────────────────────

const DAY = 86_400_000;

test('the pot seeds with the daily 500 and tops up per elapsed day (lazy)', () => {
  const guildId = freshGuildId();
  assert.equal(getPot(guildId, 0).balance, 500, 'first sight = today’s contribution');
  assert.equal(getPot(guildId, 1_000).balance, 500, 'same day: no double top-up');
  assert.equal(getPot(guildId, DAY).balance, 1_000, 'next day adds 500');
  assert.equal(getPot(guildId, 4 * DAY).balance, 2_500, 'missed days catch up');
});

test('games feed the pot via addToPot', () => {
  const guildId = freshGuildId();
  assert.equal(addToPot(guildId, 250, 0), 750, '500 daily + 250 game loss');
});

test('tryPot: one attempt per member per day, 0.5% odds, winner takes all', () => {
  const guildId = freshGuildId();
  addToPot(guildId, 1_500, 0); // pot = 2000

  const lose = tryPot(guildId, 'alice', { random: () => 0.005, now: 0 });
  assert.equal(lose.code, 'lose', '0.005 is NOT below the 0.5% threshold');
  assert.equal(lose.balance, 2_000, 'the pot keeps everything on a miss');

  assert.equal(tryPot(guildId, 'alice', { random: () => 0, now: 1_000 }).code, 'already');
  assert.equal(tryPot(guildId, 'bob', { random: () => 0.9, now: 0 }).code, 'lose', 'per-member, not global');

  const win = tryPot(guildId, 'alice', { random: () => 0.0049, now: DAY });
  assert.equal(win.code, 'win');
  assert.equal(win.amount, 2_500, 'yesterday’s 2000 + the new day’s 500');
  assert.equal(balanceOf(guildId, 'alice'), 12_500);
  assert.equal(getPot(guildId, DAY).balance, 0, 'the pot resets after a jackpot');
  assert.equal(getPot(guildId, 2 * DAY).balance, 500, 'and reseeds the next day');
});

test('tryPot refuses when the economy is disabled', () => {
  const guildId = freshGuildId();
  setEconomyConfig(guildId, { enabled: false });
  assert.equal(tryPot(guildId, 'x', { now: 0 }).code, 'disabled');
});

// ── the hunt, end to end ─────────────────────────────────────────────────────

function fakeChannel(guild, id) {
  const channel = {
    id,
    guild,
    sends: [],
    send: async (payload) => {
      channel.sends.push(payload);
      return { id: `msg-${channel.sends.length}` };
    },
  };
  guild.channels.cache.set(id, channel);
  return channel;
}

function fakeEconomyGuild(guildId, { memberIds = [], messageContent = true } = {}) {
  const guild = {
    id: guildId,
    channels: { cache: new Map() },
    members: {
      cache: new Map(
        memberIds.map((id) => [id, { id, user: { bot: false }, displayName: `name-${id}` }]),
      ),
    },
  };
  guild.client = { config: { homeGuildId: guildId }, messageContentAvailable: messageContent };
  return guild;
}

const fakeMessage = (guild, channel, userId, content) => ({
  guild,
  channel,
  client: guild.client,
  author: { id: userId, bot: false, username: `user-${userId}` },
  member: { displayName: `officer-${userId}` },
  content,
  system: false,
});

test('spawn → STOP POLICE catch pays the officer and closes the hunt', async () => {
  const guildId = freshGuildId();
  const guild = fakeEconomyGuild(guildId);
  const channel = fakeChannel(guild, 'street');

  assert.equal(await spawnHunt(channel, { durationMs: 60_000, random: () => 0 }), true);
  assert.match(channel.sends[0].content, /crook is sprinting/);
  assert.ok(activeHunt('street'), 'hunt is open');
  assert.equal(await spawnHunt(channel, {}), true, 'spawnHunt itself does not gate — the watcher does');

  resetHuntState();
  await spawnHunt(channel, { durationMs: 60_000, random: () => 0 }); // reward = min = 100
  const caught = await resolveCatch(fakeMessage(guild, channel, 'hero', 'STOP POLICE!!'));
  assert.equal(caught, 100);
  assert.equal(balanceOf(guildId, 'hero'), 10_100);
  assert.equal(activeHunt('street'), null, 'hunt closed');
  assert.match(channel.sends.at(-1).content, /GOTCHA/);
  assert.deepEqual(channel.sends.at(-1).allowedMentions, { parse: [] });

  const again = await resolveCatch(fakeMessage(guild, channel, 'late', 'stop police'));
  assert.equal(again, null, 'second shout hits nothing');
});

test('expiry: the crook steals from a random member and says so (never pings)', async () => {
  const guildId = freshGuildId();
  const guild = fakeEconomyGuild(guildId, { memberIds: ['victim'] });
  const channel = fakeChannel(guild, 'alley');

  await spawnHunt(channel, { durationMs: 15, random: () => 0 }); // steal = min = 50
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(activeHunt('alley'), null, 'hunt expired');
  const last = channel.sends.at(-1);
  assert.match(last.content, /got away/);
  assert.match(last.content, /50 donuts/);
  assert.match(last.content, /name-victim/);
  assert.deepEqual(last.allowedMentions, { parse: [] });
  assert.equal(balanceOf(guildId, 'victim'), 9_950, 'stolen from the starting 10k');
  assert.equal(getPot(guildId).balance, 550, 'the crook stashes the loot in the pot (500 daily + 50)');
  assert.match(last.content, /donut pot/);
});

test('expiry with nobody around: the crook gets away empty-handed', async () => {
  const guildId = freshGuildId();
  const guild = fakeEconomyGuild(guildId, { memberIds: [] });
  const channel = fakeChannel(guild, 'ghost-town');
  await spawnHunt(channel, { durationMs: 15, random: () => 0 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(channel.sends.at(-1).content, /nothing in their pockets/);
});

test('the watcher: earns, catches, and never spawns without Message Content', async () => {
  const guildId = freshGuildId();
  const guild = fakeEconomyGuild(guildId, { messageContent: false });
  const channel = fakeChannel(guild, 'main');

  // Without Message Content: activity still pays, hunts never spawn.
  setEconomyConfig(guildId, { huntChance: 1 });
  for (const user of ['a', 'b', 'a', 'b', 'a']) {
    await economyWatch.execute(fakeMessage(guild, channel, user, 'hello'));
  }
  assert.equal(channel.sends.length, 0, 'no crook without the intent (unwinnable game)');
  assert.equal(balanceOf(guildId, 'a'), 10_005, 'activity pay works without content');

  // With the intent: the same activity spawns (chance forced to 1)…
  guild.client.messageContentAvailable = true;
  await economyWatch.execute(fakeMessage(guild, channel, 'b', 'more chatter'));
  assert.equal(channel.sends.length, 1, 'crook spawned');
  assert.ok(activeHunt('main'));

  // …and a STOP POLICE catches it via the same watcher.
  await economyWatch.execute(fakeMessage(guild, channel, 'a', 'STOP POLICE'));
  assert.equal(activeHunt('main'), null);
  assert.match(channel.sends.at(-1).content, /GOTCHA/);
});

test('birthday sweep announces the 50k gift in the message', async () => {
  const guildId = freshGuildId();
  const guild = fakeEconomyGuild(guildId);
  const lobby = fakeChannel(guild, '411609312037961729');
  setBirthday(guildId, 'jarige', { day: new Date().getUTCDate(), month: new Date().getUTCMonth() + 1, timeZone: 'UTC' });

  const announced = await sweepBirthdays(guild, Date.now());
  assert.equal(announced, 1);
  const sent = lobby.sends.at(-1);
  assert.match(sent.content, /birthday/);
  assert.match(sent.content, /50,000 donuts/);
  assert.equal(balanceOf(guildId, 'jarige'), 60_000, '10k start + 50k gift');
});
