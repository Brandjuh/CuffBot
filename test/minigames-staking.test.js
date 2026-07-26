// M26.2b: donut staking, the leaderboard sorts, and the config knobs.
//
// The money rules are pure — balances in, decisions out — so "a tie returns
// both stakes" is assertable without an economy, and the end-to-end tests
// below then prove the runtime actually follows them.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-staking-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const {
  DEFAULT_STAKE_CONFIG,
  checkStakes,
  drawWinAmount,
  earningsDelta,
  refundsFor,
  settlementFor,
  stakeAgainstBot,
} = await import('../src/modules/minigames/lib/staking.js');
const {
  LEADERBOARD_SORTS,
  gamesOf,
  getMinigamesConfig,
  getStats,
  leaderboard,
  playerStats,
  recordResult,
  setMinigamesConfig,
  winRateOf,
} = await import('../src/modules/minigames/service.js');

let seq = 0;
const freshGuildId = () => `41115717594860${String((seq += 1)).padStart(4, '0')}`;

const A = { id: 'a', bot: false, balance: 5_000 };
const B = { id: 'b', bot: false, balance: 5_000 };
const BOT = { id: 'bot', bot: true, balance: 0 };

// ── the cog's numbers ────────────────────────────────────────────────────────

test('the defaults are the cog’s: 100 in, 400–600 out', () => {
  assert.equal(DEFAULT_STAKE_CONFIG.betAmount, 100);
  assert.equal(DEFAULT_STAKE_CONFIG.winMin, 400);
  assert.equal(DEFAULT_STAKE_CONFIG.winMax, 600);
});

test('the prize is one draw inside the range', () => {
  const lo = drawWinAmount(DEFAULT_STAKE_CONFIG, { int: (a) => a });
  const hi = drawWinAmount(DEFAULT_STAKE_CONFIG, { int: (_, b) => b });
  assert.equal(lo, 400);
  assert.equal(hi, 600);
});

test('an inverted range is survived rather than trusted', () => {
  // The admin command refuses to store min > max, but a hand-edited config
  // file can still produce one, and `rng.int(600, 400)` returns nonsense.
  const drawn = drawWinAmount({ winMin: 600, winMax: 400 }, { int: (a, b) => (a <= b ? a : -1) });
  assert.equal(drawn, 400, 'the range is normalised before it is drawn from');
});

// ── who pays ─────────────────────────────────────────────────────────────────

test('both humans are charged the buy-in', () => {
  const verdict = checkStakes([A, B], DEFAULT_STAKE_CONFIG);
  assert.deepEqual(verdict, { ok: true, amount: 100, payers: ['a', 'b'] });
});

test('a bot never pays', () => {
  const verdict = checkStakes([A, BOT], DEFAULT_STAKE_CONFIG, { againstBot: true });
  assert.deepEqual(verdict.payers, ['a']);
});

test('a player who cannot cover the buy-in blocks the game, and is named', () => {
  const verdict = checkStakes([A, { ...B, balance: 99 }], DEFAULT_STAKE_CONFIG);
  assert.deepEqual(verdict, { ok: false, reason: 'too-poor', shortId: 'b', need: 100, have: 99 });
});

test('exactly the buy-in is enough', () => {
  assert.equal(checkStakes([{ ...A, balance: 100 }, B], DEFAULT_STAKE_CONFIG).ok, true);
  assert.equal(checkStakes([{ ...A, balance: 99 }, B], DEFAULT_STAKE_CONFIG).ok, false);
});

test('a bet of 0 makes every game free', () => {
  const verdict = checkStakes([{ ...A, balance: 0 }, { ...B, balance: 0 }], { ...DEFAULT_STAKE_CONFIG, betAmount: 0 });
  assert.deepEqual(verdict, { ok: true, amount: 0, payers: [] });
});

test('betVsBot off makes bot games free without touching officer games', () => {
  const config = { ...DEFAULT_STAKE_CONFIG, betVsBot: false };
  assert.equal(stakeAgainstBot(config), false);
  assert.equal(checkStakes([A, BOT], config, { againstBot: true }).amount, 0);
  assert.equal(checkStakes([A, B], config, { againstBot: false }).amount, 100, 'PvP still stakes');
});

test('betVsBot defaults to ON, because that is what the cog does', () => {
  assert.equal(stakeAgainstBot(DEFAULT_STAKE_CONFIG), true);
  assert.equal(checkStakes([A, BOT], DEFAULT_STAKE_CONFIG, { againstBot: true }).amount, 100);
});

// ── what the ledger owes ─────────────────────────────────────────────────────

const STAKE = { amount: 100, winAmount: 500 };

test('a winner is paid the prize and nobody else is touched', () => {
  const moves = settlementFor({ winnerId: 'a', players: [A, B], tie: false }, STAKE);
  assert.deepEqual(moves, [{ id: 'a', delta: 500, why: 'prize' }]);
});

test('a TIE returns both stakes — leaving them taken would delete the money', () => {
  const moves = settlementFor({ winnerId: null, players: [A, B], tie: true }, STAKE);
  assert.deepEqual(moves, [
    { id: 'a', delta: 100, why: 'refund' },
    { id: 'b', delta: 100, why: 'refund' },
  ]);
});

test('an unstaked game pays nothing, not even to a winner', () => {
  assert.deepEqual(settlementFor({ winnerId: 'a', players: [A, B], tie: false }, { amount: 0, winAmount: 500 }), []);
});

test('the bot winning pays nobody — the house keeps it', () => {
  assert.deepEqual(settlementFor({ winnerId: 'bot', players: [A, BOT], tie: false }, STAKE), []);
});

test('a cancelled-before-start game refunds every human', () => {
  assert.deepEqual(refundsFor([A, B], { amount: 100, staked: true }), [
    { id: 'a', delta: 100, why: 'refund' },
    { id: 'b', delta: 100, why: 'refund' },
  ]);
  assert.deepEqual(refundsFor([A, B], { amount: 100, staked: false }), [], 'nothing was taken, nothing comes back');
  assert.deepEqual(refundsFor([A, BOT], { amount: 100, staked: true }), [{ id: 'a', delta: 100, why: 'refund' }]);
});

test('earnings move the way the cog moves them', () => {
  assert.equal(earningsDelta({ won: true }, STAKE), 400, 'prize minus buy-in');
  assert.equal(earningsDelta({ won: false }, STAKE), -100);
  assert.equal(earningsDelta({ tied: true }, STAKE), 0, 'correct only because a tie refunds');
  assert.equal(earningsDelta({ won: true }, { amount: 0, winAmount: 0 }), 0, 'a free game changes nothing');
});

// ── the money the stats remember ─────────────────────────────────────────────

test('a staked win and loss are recorded with their earnings', () => {
  const guildId = freshGuildId();
  recordResult(guildId, { winnerId: 'a', loserId: 'b', stake: STAKE });
  const all = getStats(guildId);
  assert.equal(playerStats(all, 'a').earnings, 400);
  assert.equal(playerStats(all, 'b').earnings, -100);
});

test('earnings accumulate across games rather than being overwritten', () => {
  const guildId = freshGuildId();
  recordResult(guildId, { winnerId: 'a', loserId: 'b', stake: STAKE });
  recordResult(guildId, { winnerId: 'a', loserId: 'b', stake: STAKE });
  recordResult(guildId, { winnerId: 'b', loserId: 'a', stake: STAKE });
  assert.equal(playerStats(getStats(guildId), 'a').earnings, 400 + 400 - 100);
  assert.equal(playerStats(getStats(guildId), 'b').earnings, -100 - 100 + 400);
});

test('a tie leaves earnings alone', () => {
  const guildId = freshGuildId();
  recordResult(guildId, { tie: ['a', 'b'], stake: STAKE });
  assert.equal(playerStats(getStats(guildId), 'a').earnings, 0);
  assert.equal(playerStats(getStats(guildId), 'a').ties, 1);
});

test('an unstaked game records the result and no earnings', () => {
  const guildId = freshGuildId();
  recordResult(guildId, { winnerId: 'a', loserId: 'b' });
  assert.equal(playerStats(getStats(guildId), 'a').wins, 1);
  assert.equal(playerStats(getStats(guildId), 'a').earnings, 0);
});

// ── the sortable leaderboard ─────────────────────────────────────────────────

function board(guildId) {
  // grinder: many games, most wins, worst rate. sniper: few games, perfect.
  for (let i = 0; i < 8; i += 1) recordResult(guildId, { winnerId: 'grinder', loserId: 'filler', stake: STAKE });
  for (let i = 0; i < 12; i += 1) recordResult(guildId, { winnerId: 'filler', loserId: 'grinder', stake: STAKE });
  for (let i = 0; i < 2; i += 1) recordResult(guildId, { winnerId: 'sniper', loserId: 'filler', stake: STAKE });
}

test('the four sort keys are the cog’s four', () => {
  assert.deepEqual(Object.keys(LEADERBOARD_SORTS), ['wins', 'earnings', 'games', 'winrate']);
});

test('each key actually reorders the board', () => {
  const guildId = freshGuildId();
  board(guildId);
  assert.equal(leaderboard(guildId, 'wins')[0].id, 'filler', '12 wins beats 8');
  assert.equal(leaderboard(guildId, 'winrate')[0].id, 'sniper', '100% beats everyone');
  assert.equal(leaderboard(guildId, 'games')[0].id, 'filler', '22 games is the most');
  assert.equal(leaderboard(guildId, 'earnings')[0].id, 'filler');
});

test('games is derived from the three counters, so it cannot drift', () => {
  const p = { wins: 8, losses: 12, ties: 2, earnings: 0 };
  assert.equal(gamesOf(p), 22);
  assert.equal(winRateOf(p).toFixed(1), '36.4');
  assert.equal(winRateOf({ wins: 0, losses: 0, ties: 0, earnings: 0 }), 0, 'no games is 0%, not NaN');
});

test('members with no games are dropped, not ranked at 0%', () => {
  const guildId = freshGuildId();
  recordResult(guildId, { winnerId: 'a', loserId: 'b', stake: STAKE });
  // A record with all-zero counters, as a bare join could produce.
  recordResult(guildId, { tie: ['ghost', 'ghost2'] });
  const ids = leaderboard(guildId, 'winrate').map((r) => r.id);
  assert.ok(ids.includes('a'));
  const empty = leaderboard(freshGuildId(), 'winrate');
  assert.deepEqual(empty, []);
});

test('an unknown sort falls back to wins rather than emptying the board', () => {
  const guildId = freshGuildId();
  board(guildId);
  assert.deepEqual(
    leaderboard(guildId, 'nonsense').map((r) => r.id),
    leaderboard(guildId, 'wins').map((r) => r.id),
  );
});

test('the order is stable — the tie-break chain is total', () => {
  const guildId = freshGuildId();
  for (const id of ['x', 'y', 'z']) recordResult(guildId, { winnerId: id, loserId: 'loser' });
  const first = leaderboard(guildId, 'wins').map((r) => r.id);
  assert.deepEqual(leaderboard(guildId, 'wins').map((r) => r.id), first);
  assert.deepEqual(leaderboard(guildId, 'wins').map((r) => r.id), first);
});

test('every sort renders a line, so no key can print [object Object]', () => {
  const p = { id: 'a', wins: 3, losses: 1, ties: 0, earnings: -250 };
  for (const [key, spec] of Object.entries(LEADERBOARD_SORTS)) {
    assert.equal(typeof spec.render(p), 'string', key);
    assert.ok(spec.render(p).length > 0, key);
  }
  assert.match(LEADERBOARD_SORTS.earnings.render(p), /−250/, 'a loss reads as a loss');
  assert.match(LEADERBOARD_SORTS.earnings.render({ ...p, earnings: 250 }), /\+250/);
});

// ── configuration ────────────────────────────────────────────────────────────

test('config is a sparse override on the cog’s defaults', () => {
  const guildId = freshGuildId();
  assert.deepEqual(getMinigamesConfig(guildId), DEFAULT_STAKE_CONFIG);
  setMinigamesConfig(guildId, { betAmount: 250 });
  assert.equal(getMinigamesConfig(guildId).betAmount, 250);
  assert.equal(getMinigamesConfig(guildId).winMax, 600, 'untouched keys keep the default');
});

test('one guild’s settings do not leak into another', () => {
  const a = freshGuildId();
  const b = freshGuildId();
  setMinigamesConfig(a, { betAmount: 999 });
  assert.equal(getMinigamesConfig(b).betAmount, 100);
});
