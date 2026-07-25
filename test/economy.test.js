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
import donutsCmd from '../src/modules/economy/commands/donuts.js';
import donutBoardCmd from '../src/modules/economy/commands/donut-board.js';
import dailyCmd from '../src/modules/economy/commands/daily.js';
import potCmd from '../src/modules/economy/commands/pot.js';
import crackPotCmd from '../src/modules/economy/commands/crack-pot.js';
import stealCmd from '../src/modules/economy/commands/steal.js';
import claimsCmd from '../src/modules/economy/commands/claims.js';
import { dispatchCommand } from '../src/core/prefix/command.js';
import { fakeMessage, fakeUser } from './fixtures/fake-message.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-economy-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `40000000000000${String((seq += 1)).padStart(4, '0')}`;
const OFFICER = '600000000000000001';
const MATE = '600000000000000002';

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

// ── payday-style claims (S67 = M16.2) ────────────────────────────────────────

test('claim defaults keep S49 behavior: day 25, everything else off, streaks off', async () => {
  const { CLAIM_INTERVALS } = await import('../src/modules/economy/lib/bank.js');
  assert.equal(DEFAULT_ECONOMY_CONFIG.claimDay, 25);
  for (const key of ['claimHour', 'claimWeek', 'claimMonth', 'claimQuarter', 'claimYear']) {
    assert.equal(DEFAULT_ECONOMY_CONFIG[key], 0, `${key} off by default`);
  }
  assert.equal(DEFAULT_ECONOMY_CONFIG.streakBonus, 0);
  assert.equal(CLAIM_INTERVALS.find((i) => i.key === 'quarter').hours, 2184, 'the cog’s hour table');
});

test('evaluateClaim: cooldown, streak window [T,2T), lapse, percent-floor formula', async () => {
  const { evaluateClaim } = await import('../src/modules/economy/lib/bank.js');
  const HOUR = 3_600_000;
  const base = { amount: 100, streakBonus: 40, hours: 1 };
  assert.deepEqual(evaluateClaim({ ...base, lastClaimAt: null, now: 0 }), { code: 'claim', amount: 100, bonus: 0 });
  assert.deepEqual(evaluateClaim({ ...base, lastClaimAt: 0, now: HOUR - 1 }), { code: 'cooldown', waitMs: 1 });
  assert.deepEqual(evaluateClaim({ ...base, lastClaimAt: 0, now: HOUR }), { code: 'claim', amount: 100, bonus: 40 }, 'on-time = streak');
  assert.deepEqual(evaluateClaim({ ...base, lastClaimAt: 0, now: 2 * HOUR - 1 }), { code: 'claim', amount: 100, bonus: 40 }, 'edge of the window');
  assert.deepEqual(evaluateClaim({ ...base, lastClaimAt: 0, now: 2 * HOUR }), { code: 'claim', amount: 100, bonus: 0 }, 'lapsed — base only');
  assert.deepEqual(
    evaluateClaim({ ...base, streakBonus: 250, streakPercent: true, lastClaimAt: 0, now: HOUR }),
    { code: 'claim', amount: 100, bonus: 200 },
    'percent mode: base × floor(250/100) — the cog’s exact formula',
  );
  assert.deepEqual(evaluateClaim({ amount: 0, hours: 1, lastClaimAt: null, now: 0 }), { code: 'off' });
});

test('claimInterval stamps per interval; legacy lastDailyAt counts as the day claim', async () => {
  const { claimInterval, peekClaim } = await import('../src/modules/economy/service.js');
  const { getGuildData, setGuildData } = await import('../src/core/store.js');
  const guildId = freshGuildId();
  const HOUR = 3_600_000;
  setEconomyConfig(guildId, { claimHour: 10 });

  const first = claimInterval(guildId, 'm', 'hour', { now: 1_000_000 });
  assert.equal(first.code, 'claimed');
  assert.equal(first.balance, 10_010);
  assert.equal(claimInterval(guildId, 'm', 'hour', { now: 1_000_000 + HOUR / 2 }).code, 'cooldown');

  // Legacy migration: a pre-S67 lastDailyAt mid-window blocks the day claim.
  setGuildData(guildId, 'economyUsers', {
    ...getGuildData(guildId, 'economyUsers', {}),
    legacy: { balance: 10_000, lastEarnAt: null, lastDailyAt: 1_000_000 },
  });
  assert.equal(peekClaim(guildId, 'legacy', 'day', { now: 1_000_000 + 12 * HOUR }).code, 'cooldown');
  assert.equal(claimInterval(guildId, 'legacy', 'day', { now: 1_000_000 + 24 * HOUR }).code, 'claimed');
});

test('claimAll collects only what is ready and totals the streak bonus', async () => {
  const { claimAll } = await import('../src/modules/economy/service.js');
  const guildId = freshGuildId();
  const HOUR = 3_600_000;
  setEconomyConfig(guildId, { claimHour: 10, claimWeek: 500, streakBonus: 5 });

  const first = claimAll(guildId, 'm', { now: 1_000_000 });
  assert.deepEqual(first.claimed.map((r) => r.key), ['hour', 'day', 'week'], 'first-ever claims everything enabled');
  assert.equal(first.total, 10 + 25 + 500);
  assert.equal(first.totalBonus, 0, 'no streak on first claims');

  // 90 min later: only the hour is ready again — and on streak.
  const second = claimAll(guildId, 'm', { now: 1_000_000 + 1.5 * HOUR });
  assert.deepEqual(second.claimed.map((r) => r.key), ['hour']);
  assert.equal(second.totalBonus, 5, 'claimed within [T, 2T)');

  const third = claimAll(guildId, 'm', { now: 1_000_000 + 1.6 * HOUR });
  assert.equal(third.claimed.length, 0, 'nothing ready — nothing collected');
});

test('/daily via the engine: day amount 0 reads as disabled; streaks apply', async () => {
  const guildId = freshGuildId();
  const HOUR = 3_600_000;
  setEconomyConfig(guildId, { streakBonus: 5 });
  assert.equal(claimDaily(guildId, 'm', { now: 1_000_000 }).code, 'claimed');
  const onTime = claimDaily(guildId, 'm', { now: 1_000_000 + 25 * HOUR });
  assert.equal(onTime.code, 'claimed');
  assert.equal(onTime.bonus, 5, 'daily streak bonus');
  setEconomyConfig(guildId, { claimDay: 0 });
  assert.equal(claimDaily(guildId, 'other', { now: 1 }).code, 'disabled');
});

// ── the seven flat commands (converted in S95 = M17.3 slice C) ───────────────
// None of them had a command-level test before the conversion; only the
// service beneath them did.

/** Dispatch an economy command as OFFICER in a fresh guild. */
async function run(command, tokens, { guildId = freshGuildId(), people = [] } = {}) {
  const self = fakeUser(OFFICER, 'officer', { displayName: 'officer' });
  const users = Object.fromEntries([self, ...people].map((u) => [u.id, u]));
  const message = fakeMessage({ guildId, authorId: OFFICER, users });
  const outcome = await dispatchCommand(command.command, message, tokens, '!');
  return { outcome, sent: message.sent, guildId };
}

const bodyOf = (reply) =>
  reply.content ?? (reply.embeds[0].data?.description ?? reply.embeds[0].description);

test('!donuts reads your own wallet, and another officer’s by mention', async () => {
  const guildId = freshGuildId();
  // Everyone opens at startingBalance (10,000 — S38 owner decision), so these
  // assert the DELTA rather than an absolute figure.
  const start = DEFAULT_ECONOMY_CONFIG.startingBalance;
  adjustBalance(guildId, OFFICER, 250);
  adjustBalance(guildId, MATE, 40);

  const mine = await run(donutsCmd, [], { guildId });
  assert.equal(mine.sent[0].content, `🍩 You have **${(start + 250).toLocaleString('en-US')} donuts**.`);

  const theirs = await run(donutsCmd, [`<@${MATE}>`], {
    guildId,
    people: [fakeUser(MATE, 'mate')],
  });
  assert.equal(
    theirs.sent[0].content,
    `🍩 <@${MATE}> has **${(start + 40).toLocaleString('en-US')} donuts**.`,
  );
});

test('!donuts refuses to audit a bot', async () => {
  const bot = fakeUser(MATE, 'K9', { bot: true });
  const { sent } = await run(donutsCmd, [`<@${MATE}>`], { people: [bot] });
  assert.match(sent[0].content, /Bots run on electricity/);
});

test('!donut-board ranks by balance and honours the size bounds', async () => {
  const guildId = freshGuildId();
  adjustBalance(guildId, OFFICER, 10);
  adjustBalance(guildId, MATE, 900);

  const board = await run(donutBoardCmd, [], { guildId });
  const desc = bodyOf(board.sent[0]);
  assert.ok(desc.indexOf(MATE) < desc.indexOf(OFFICER), 'richest first');
  assert.match(desc, /🥇/);

  const tooMany = await run(donutBoardCmd, ['99'], { guildId });
  assert.equal(tooMany.outcome, 'usage-error');
  assert.match(tooMany.sent[0].content, /between 1 and 25/);
});

test('!donut-board says so when nobody has moved a donut', async () => {
  const { sent } = await run(donutBoardCmd, []);
  assert.match(sent[0].content, /Nobody has moved a single donut/);
});

test('!daily pays once, then reports the wait', async () => {
  const guildId = freshGuildId();
  const first = await run(dailyCmd, [], { guildId });
  assert.match(first.sent[0].content, /Daily ration collected/);
  const second = await run(dailyCmd, [], { guildId });
  assert.match(second.sent[0].content, /already collected today’s ration/);
});

test('!pot shows the balance and whether the daily shot is open', async () => {
  const guildId = freshGuildId();
  addToPot(guildId, 1234);
  const expected = getPot(guildId).balance.toLocaleString('en-US');
  const before = await run(potCmd, [], { guildId });
  assert.match(bodyOf(before.sent[0]), new RegExp(expected));
  assert.match(bodyOf(before.sent[0]), /still open/);

  await run(crackPotCmd, [], { guildId });
  const after = await run(potCmd, [], { guildId });
  assert.match(bodyOf(after.sent[0]), /used for today/);
});

test('!crack-pot spends the one daily attempt', async () => {
  const guildId = freshGuildId();
  addToPot(guildId, 500);
  const first = await run(crackPotCmd, [], { guildId });
  // 0.5% odds, so the loss branch is what a test normally sees — accept both
  // by matching the descriptions rather than the titles.
  assert.match(bodyOf(first.sent[0]), /rattles it|cracked the pot/);
  const second = await run(crackPotCmd, [], { guildId });
  assert.match(second.sent[0].content, /already took today’s shot/);
});

test('!steal refuses a bot target and needs a target at all', async () => {
  const bot = fakeUser(MATE, 'K9', { bot: true });
  const atBot = await run(stealCmd, [`<@${MATE}>`], { people: [bot] });
  assert.match(atBot.sent[0].content, /unstealable/);

  const bare = await run(stealCmd, []);
  assert.equal(bare.outcome, 'usage-error');
  assert.match(bare.sent[0].content, /missing `target`/);
});

test('!steal refuses to rob yourself', async () => {
  const { sent } = await run(stealCmd, [`<@${OFFICER}>`]);
  assert.match(sent[0].content, /between pockets/);
});

test('!claims lists the timers, and `true` collects', async () => {
  const guildId = freshGuildId();
  const view = await run(claimsCmd, [], { guildId });
  assert.match(bodyOf(view.sent[0]), /Pot attempt/);
  assert.doesNotMatch(bodyOf(view.sent[0]), /Collected/);

  const collected = await run(claimsCmd, ['true'], { guildId });
  assert.match(bodyOf(collected.sent[0]), /Collected|Nothing is ready/);
});

test('!claims accepts the collect: keyword form too', async () => {
  const { outcome, sent } = await run(claimsCmd, ['collect:yes']);
  assert.equal(outcome, 'ran');
  assert.match(bodyOf(sent[0]), /Collected|Nothing is ready/);
});
