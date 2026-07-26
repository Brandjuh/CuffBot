// M26.2b: staking end to end, through the real economy seam.
//
// `lib/staking.js` decides what is owed and `test/minigames-staking.test.js`
// pins those decisions. What is asserted here is that the runtime actually
// carries them out — because a rule the code agrees with and never executes is
// worth nothing, and every bug in this file costs somebody real donuts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-mg-money-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const { refundStakes, settleIfOver, stakeFor, takeStakes } = await import('../src/modules/minigames/runtime.js');
const { clearGames, createSession, getStats, playerStats, setMinigamesConfig } = await import(
  '../src/modules/minigames/service.js'
);
const { balanceOf, adjustBalance } = await import('../src/modules/economy/service.js');
const { NONE, TIE, newGame, playColumn } = await import('../src/modules/minigames/lib/connect4.js');

let seq = 0;
const freshGuildId = () => `41115717594870${String((seq += 1)).padStart(4, '0')}`;

const A = { id: '111111111111111111', name: 'Rook', bot: false };
const B = { id: '222222222222222222', name: 'Vance', bot: false };
const BOT = { id: '333333333333333333', name: 'CuffBot', bot: true };

/** A fixed 500 prize, so every expected number below is arithmetic, not luck. */
const fixedPrize = { int: () => 500 };

function staked(guildId, { players = [A, B], againstBot = false } = {}) {
  clearGames();
  return createSession({
    channelId: `chan-${guildId}`,
    guildId,
    players,
    againstBot,
    game: 'connect4',
    state: newGame(() => 0), // RED (seat 0) opens, deterministically
    stake: stakeFor(guildId, { againstBot }, fixedPrize),
  });
}

/** RED wins on its fourth move; BLUE wastes three in column 6. */
const RED_WINS = [0, 6, 1, 6, 2, 6, 3];

async function play(game, columns) {
  for (const column of columns) game.state = playColumn(game.state, column);
  await settleIfOver(game);
  return game;
}

// ── taking the money ─────────────────────────────────────────────────────────

test('accepting takes the buy-in from both players', async () => {
  const guildId = freshGuildId();
  const before = await balanceOf(guildId, A.id);
  const game = staked(guildId);
  assert.equal(game.stake.amount, 100);
  assert.equal(game.stake.taken, false, 'an unanswered invitation costs nothing');

  assert.deepEqual(await takeStakes(game), { ok: true });
  assert.equal(game.stake.taken, true);
  assert.equal(await balanceOf(guildId, A.id), before - 100);
  assert.equal(await balanceOf(guildId, B.id), before - 100);
});

test('taking twice does not charge twice', async () => {
  const guildId = freshGuildId();
  const game = staked(guildId);
  await takeStakes(game);
  const after = await balanceOf(guildId, A.id);
  await takeStakes(game);
  await takeStakes(game);
  assert.equal(await balanceOf(guildId, A.id), after);
});

test('a player who cannot pay stops the game, and nobody is charged', async () => {
  const guildId = freshGuildId();
  await adjustBalance(guildId, B.id, -(await balanceOf(guildId, B.id))); // broke
  const beforeA = await balanceOf(guildId, A.id);
  const game = staked(guildId);

  const verdict = await takeStakes(game);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.shortId, B.id);
  assert.equal(game.stake.taken, false);
  assert.equal(await balanceOf(guildId, A.id), beforeA, 'the solvent player must not be charged either');
});

// ── paying it out ────────────────────────────────────────────────────────────

test('the winner is paid the prize; the loser is out the buy-in', async () => {
  const guildId = freshGuildId();
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId);
  await takeStakes(game);
  await play(game, RED_WINS);

  assert.equal(game.state.winner, 0, 'RED won');
  assert.equal(await balanceOf(guildId, A.id), start - 100 + 500);
  assert.equal(await balanceOf(guildId, B.id), start - 100);
});

test('a tie hands both stakes back', async () => {
  const guildId = freshGuildId();
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId);
  await takeStakes(game);
  // Force the tie the pure layer already covers; reaching one over a real 7×6
  // board would take 42 scripted moves and prove nothing extra here.
  game.state = { ...game.state, winner: TIE, time: 42 };
  await settleIfOver(game);

  assert.equal(await balanceOf(guildId, A.id), start, 'nobody is out of pocket on a tie');
  assert.equal(await balanceOf(guildId, B.id), start);
});

test('settling twice does not pay the prize twice', async () => {
  // The S22 claim-before-act shape, now with money attached: a second settle
  // used only to duplicate a stat line, and would now duplicate a payout.
  const guildId = freshGuildId();
  const game = staked(guildId);
  await takeStakes(game);
  await play(game, RED_WINS);
  const afterFirst = await balanceOf(guildId, A.id);

  await settleIfOver(game);
  await settleIfOver(game);
  assert.equal(await balanceOf(guildId, A.id), afterFirst);
  assert.equal(getStats(guildId).played, 1);
});

test('an unfinished game moves no money', async () => {
  const guildId = freshGuildId();
  const game = staked(guildId);
  await takeStakes(game);
  const afterStake = await balanceOf(guildId, A.id);
  game.state = playColumn(game.state, 3);
  await settleIfOver(game);
  assert.equal(game.state.winner, NONE);
  assert.equal(await balanceOf(guildId, A.id), afterStake);
});

// ── giving it back ───────────────────────────────────────────────────────────

test('cancelling a started-but-unplayed game refunds both', async () => {
  const guildId = freshGuildId();
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId);
  await takeStakes(game);
  await refundStakes(game);
  assert.equal(await balanceOf(guildId, A.id), start);
  assert.equal(game.stake.taken, false);
});

test('refunding twice does not mint donuts', async () => {
  const guildId = freshGuildId();
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId);
  await takeStakes(game);
  await refundStakes(game);
  await refundStakes(game);
  await refundStakes(game);
  assert.equal(await balanceOf(guildId, A.id), start, 'the second refund must be a no-op');
});

test('refunding a game nobody paid for is a no-op', async () => {
  const guildId = freshGuildId();
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId);
  await refundStakes(game); // never accepted
  assert.equal(await balanceOf(guildId, A.id), start);
});

// ── the bot ──────────────────────────────────────────────────────────────────

test('the bot never pays and is never paid', async () => {
  const guildId = freshGuildId();
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId, { players: [A, BOT], againstBot: true });
  await takeStakes(game);
  assert.equal(await balanceOf(guildId, A.id), start - 100, 'the human still stakes — the cog charges here');
  assert.equal(await balanceOf(guildId, BOT.id), 10_000, 'the bot is untouched');

  // The bot wins: the human's stake is gone and nothing is paid out.
  game.state = { ...game.state, winner: 1, time: 8 };
  await settleIfOver(game);
  assert.equal(await balanceOf(guildId, A.id), start - 100);
});

test('beating the bot pays the full prize — the faucet betVsBot exists to close', async () => {
  const guildId = freshGuildId();
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId, { players: [A, BOT], againstBot: true });
  await takeStakes(game);
  await play(game, RED_WINS);
  assert.equal(await balanceOf(guildId, A.id), start - 100 + 500, '+400 net per win against a beatable heuristic');
});

test('betVsBot off makes bot games cost and pay nothing', async () => {
  const guildId = freshGuildId();
  setMinigamesConfig(guildId, { betVsBot: false });
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId, { players: [A, BOT], againstBot: true });
  assert.equal(game.stake.amount, 0);
  await takeStakes(game);
  await play(game, RED_WINS);
  assert.equal(await balanceOf(guildId, A.id), start, 'no buy-in, no prize');
});

test('betVsBot off leaves officer-versus-officer staking alone', async () => {
  const guildId = freshGuildId();
  setMinigamesConfig(guildId, { betVsBot: false });
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId, { players: [A, B], againstBot: false });
  assert.equal(game.stake.amount, 100);
  await takeStakes(game);
  await play(game, RED_WINS);
  assert.equal(await balanceOf(guildId, A.id), start - 100 + 500);
});

// ── free mode ────────────────────────────────────────────────────────────────

test('a bet of 0 plays a full game without touching a wallet', async () => {
  const guildId = freshGuildId();
  setMinigamesConfig(guildId, { betAmount: 0 });
  const start = await balanceOf(guildId, A.id);
  const game = staked(guildId);
  assert.equal(game.stake.amount, 0);
  assert.equal(game.stake.winAmount, 0, 'no prize is drawn for a free game');
  await takeStakes(game);
  await play(game, RED_WINS);
  assert.equal(await balanceOf(guildId, A.id), start);
  assert.equal(await balanceOf(guildId, B.id), start);
  assert.equal(getStats(guildId).played, 1, 'but it still counts on the scoreboard');
});

// ── the stats agree with the ledger ──────────────────────────────────────────

test('recorded earnings match what the wallets actually did', async () => {
  // Two numbers that could drift: the ledger and the scoreboard. Assert them
  // against each other rather than each against a literal.
  const guildId = freshGuildId();
  const startA = await balanceOf(guildId, A.id);
  const startB = await balanceOf(guildId, B.id);
  const game = staked(guildId);
  await takeStakes(game);
  await play(game, RED_WINS);

  const stats = getStats(guildId);
  assert.equal(playerStats(stats, A.id).earnings, (await balanceOf(guildId, A.id)) - startA);
  assert.equal(playerStats(stats, B.id).earnings, (await balanceOf(guildId, B.id)) - startB);
});

test('a game against the bot moves money but stays off the scoreboard', async () => {
  const guildId = freshGuildId();
  const game = staked(guildId, { players: [A, BOT], againstBot: true });
  await takeStakes(game);
  await play(game, RED_WINS);
  assert.equal(getStats(guildId).played, 0, 'a human record is only meaningful against humans');
  assert.equal(playerStats(getStats(guildId), A.id).earnings, 0, 'and its winnings are not counted either');
});
