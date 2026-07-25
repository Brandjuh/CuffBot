import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_ECONOMY_CONFIG,
  earnGain,
  formatWaitMs,
  isCatchPhrase,
  pickVictim,
  randomInt,
} from '../src/modules/economy/lib/bank.js';
import {
  addToPot,
  adjustBalance,
  attemptHeist,
  claimDaily,
  awardActivity,
  balanceOf,
  getAccounts,
  getPot,
  grantBirthdayBonus,
  setEconomyConfig,
  topBalances,
  tryPot,
} from '../src/modules/economy/service.js';
import { sweepBirthdays, setBirthday } from '../src/modules/birthdays/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-economy-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

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

// ── /daily ration ────────────────────────────────────────────────────────────

test('daily ration: +25, once per rolling 24 hours, honest wait (S49)', () => {
  const guildId = freshGuildId();
  const HOUR = 60 * 60_000;
  const first = claimDaily(guildId, 'member', { now: 1_000_000 });
  assert.equal(first.code, 'claimed');
  assert.equal(first.amount, 25);
  assert.equal(first.balance, 10_025, 'starting 10k + the ration');

  const early = claimDaily(guildId, 'member', { now: 1_000_000 + 10 * HOUR });
  assert.equal(early.code, 'cooldown');
  assert.equal(early.waitMs, 14 * HOUR, 'exactly the remaining window');

  const next = claimDaily(guildId, 'member', { now: 1_000_000 + 24 * HOUR });
  assert.equal(next.code, 'claimed');
  assert.equal(next.balance, 10_050);

  setEconomyConfig(guildId, { enabled: false });
  assert.equal(claimDaily(guildId, 'other', { now: 1 }).code, 'disabled');
  setEconomyConfig(guildId, { enabled: true });
});

test('formatWaitMs renders hours + minutes', () => {
  assert.equal(formatWaitMs(14 * 60 * 60_000), '14 h 0 min');
  assert.equal(formatWaitMs(2 * 60 * 60_000 + 45 * 60_000), '2 h 45 min');
  assert.equal(formatWaitMs(12 * 60_000), '12 min');
  assert.equal(formatWaitMs(1), '1 min', 'always at least a minute');
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

test('birthday sweep announces the 50k gift in the message', async () => {
  const guildId = freshGuildId();
  const guild = { id: guildId, channels: { cache: new Map() }, members: { cache: new Map() } };
  const lobby = fakeChannel(guild, '411609312037961729');
  setBirthday(guildId, 'jarige', { day: new Date().getUTCDate(), month: new Date().getUTCMonth() + 1, timeZone: 'UTC' });

  const announced = await sweepBirthdays(guild, Date.now());
  assert.equal(announced, 1);
  const sent = lobby.sends.at(-1);
  assert.match(sent.content, /birthday/);
  assert.match(sent.content, /50,000 donuts/);
  assert.equal(balanceOf(guildId, 'jarige'), 60_000, '10k start + 50k gift');
});

// ── S63: /pot view state + /crack-pot split ──────────────────────────────────

test('hasPotTryToday flips after the daily attempt and resets next day (S63)', async () => {
  const { hasPotTryToday } = await import('../src/modules/economy/service.js');
  const guildId = freshGuildId();
  const day1 = Date.UTC(2026, 6, 24, 10, 0);
  assert.equal(hasPotTryToday(guildId, 'm1', day1), false);
  tryPot(guildId, 'm1', { random: () => 0.9, now: day1 });
  assert.equal(hasPotTryToday(guildId, 'm1', day1), true, 'today’s shot is used');
  assert.equal(hasPotTryToday(guildId, 'm1', day1 + 24 * 60 * 60_000), false, 'fresh after midnight UTC');
});
