// M26.2a: the panel, the session registry and result recording.
//
// The panel is the whole point of M26 — the source cog is one message that IS
// the game, and S71/S100 shipped a command per action instead. These pin the
// behaviour that makes it a panel: buttons that reflect the board, an
// invitation the challenged player must answer, and a stale game anyone can
// replace.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-minigames-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

import { BLUE, NONE, RED, TIE, newGame, playColumn } from '../src/modules/minigames/lib/connect4.js';
import { connect4Panel } from '../src/modules/minigames/lib/panel.js';
import { setGuildData } from '../src/core/store.js';
import {
  STALE_MINUTES,
  STATS_KEY,
  channelAvailability,
  clearGames,
  createSession,
  endGame,
  getStats,
  leaderboard,
  playerStats,
  recordResult,
  seatOf,
  touch,
} from '../src/modules/minigames/service.js';
import { settleIfOver } from '../src/modules/minigames/commands/minigames.js';

let seq = 0;
const freshGuildId = () => `41115717594854${String((seq += 1)).padStart(4, '0')}`;

const HUMAN_A = { id: '111111111111111111', name: 'Rook', bot: false };
const HUMAN_B = { id: '222222222222222222', name: 'Vance', bot: false };
const BOT = { id: '333333333333333333', name: 'CuffBot', bot: true };

function session({ guildId = freshGuildId(), players = [HUMAN_A, HUMAN_B], againstBot = false, now = 1000 } = {}) {
  clearGames();
  return createSession({
    channelId: 'chan-1',
    guildId,
    players,
    againstBot,
    state: { ...newGame(() => 0.1) }, // deterministic: RED opens
    now,
  });
}

// ── the panel ────────────────────────────────────────────────────────────────

test('an unaccepted game shows Accept / Decline, not the board buttons', () => {
  const panel = connect4Panel(session());
  assert.deepEqual(
    panel.buttons.map((b) => b.id),
    ['accept', 'decline'],
  );
  assert.match(panel.embed.title, /Pending invitation/);
  assert.match(panel.embed.description, /press \*\*Accept\*\*/);
});

test('once accepted the panel is seven column buttons and names whose turn it is', () => {
  const game = session();
  game.accepted = true;
  const panel = connect4Panel(game);
  assert.deepEqual(
    panel.buttons.map((b) => b.id),
    ['col:0', 'col:1', 'col:2', 'col:3', 'col:4', 'col:5', 'col:6'],
  );
  assert.equal(panel.buttons.every((b) => !b.disabled), true, 'an empty board has no full columns');
  assert.match(panel.content, /<@111111111111111111>/, 'RED opens, and RED is the challenger');
});

test('a full column is DISABLED, not left pressable', () => {
  // The cog crashed on a full-column press; S71 answered with a refusal.
  // Disabling is better still — the refusal never has to happen.
  const game = session();
  game.accepted = true;
  for (let i = 0; i < 6; i += 1) game.state = playColumn(game.state, 0);
  const panel = connect4Panel(game);
  assert.equal(panel.buttons.find((b) => b.id === 'col:0').disabled, true);
  assert.equal(panel.buttons.find((b) => b.id === 'col:1').disabled, false);
});

test('a finished game swaps every column button for a single Rematch', () => {
  const game = session();
  game.accepted = true;
  for (const c of [0, 6, 1, 6, 2, 6, 3]) game.state = playColumn(game.state, c);
  assert.equal(game.state.winner, RED);
  const panel = connect4Panel(game);
  assert.deepEqual(
    panel.buttons.map((b) => b.id),
    ['rematch'],
  );
  assert.equal(panel.done, true);
  assert.match(panel.embed.title, /Rook wins/);
  assert.equal(panel.content, null, 'nobody is being asked to move any more');
});

test('the winner gets a crown and the mover gets an arrow — never both', () => {
  const playing = session();
  playing.accepted = true;
  assert.match(connect4Panel(playing).embed.description, /▶/);
  assert.doesNotMatch(connect4Panel(playing).embed.description, /👑/);

  const won = session();
  won.accepted = true;
  for (const c of [0, 6, 1, 6, 2, 6, 3]) won.state = playColumn(won.state, c);
  const finished = connect4Panel(won).embed.description;
  assert.match(finished, /👑/);
  assert.doesNotMatch(finished, /▶/);
});

test('the bot is named in bold, humans are mentioned', () => {
  const game = session({ players: [HUMAN_A, BOT], againstBot: true });
  game.accepted = true;
  const body = connect4Panel(game).embed.description;
  assert.match(body, /<@111111111111111111>/, 'the human is pingable');
  assert.match(body, /\*\*CuffBot\*\*/, 'the bot is not');
});

test('a tie says so instead of naming a winner', () => {
  const game = session();
  game.accepted = true;
  game.state = { ...game.state, winner: TIE };
  assert.match(connect4Panel(game).embed.title, /a tie/);
});

// ── the session registry ─────────────────────────────────────────────────────

test('a channel with a live game is busy, and says how long until it can be taken', () => {
  session({ now: 1000 });
  const verdict = channelAvailability('chan-1', 1000 + 60_000);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'busy');
  assert.equal(verdict.minutesLeft, STALE_MINUTES - 1);
});

test('a game idle past the limit may be replaced by anyone', () => {
  session({ now: 1000 });
  const verdict = channelAvailability('chan-1', 1000 + STALE_MINUTES * 60_000);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, 'stale');
});

test('activity resets the staleness clock', () => {
  const game = session({ now: 1000 });
  touch(game, 1000 + 4 * 60_000);
  const verdict = channelAvailability('chan-1', 1000 + 5 * 60_000);
  assert.equal(verdict.ok, false, 'four minutes in, one minute ago — not stale');
});

test('a finished game never blocks the channel', () => {
  const game = session({ now: 1000 });
  game.finished = true;
  assert.equal(channelAvailability('chan-1', 1001).ok, true);
});

test('an empty channel is free, and ending a game frees it', () => {
  clearGames();
  // `now` is passed explicitly: the fixture stamps the session at t=1000, so
  // comparing it against the real clock would report every game as stale.
  assert.equal(channelAvailability('chan-1', 2000).reason, 'free');
  session({ now: 1000 });
  assert.equal(channelAvailability('chan-1', 2000).ok, false);
  endGame('chan-1');
  assert.equal(channelAvailability('chan-1', 2000).reason, 'free');
});

test('seats: the challenger is RED, the opponent BLUE, everyone else is nobody', () => {
  const game = session();
  assert.equal(seatOf(game, HUMAN_A.id), RED);
  assert.equal(seatOf(game, HUMAN_B.id), BLUE);
  assert.equal(seatOf(game, '999999999999999999'), -1);
});

test('a game against the bot needs no invitation', () => {
  assert.equal(session({ players: [HUMAN_A, BOT], againstBot: true }).accepted, true);
  assert.equal(session().accepted, false, 'a human opponent must accept');
});

// ── recording the result ─────────────────────────────────────────────────────

test('a decisive game credits one win and one loss', () => {
  const guildId = freshGuildId();
  const game = session({ guildId });
  game.accepted = true;
  for (const c of [0, 6, 1, 6, 2, 6, 3]) game.state = playColumn(game.state, c);
  settleIfOver(game);

  const all = getStats(guildId);
  assert.equal(all.played, 1);
  assert.deepEqual(playerStats(all, HUMAN_A.id), { wins: 1, losses: 0, ties: 0 });
  assert.deepEqual(playerStats(all, HUMAN_B.id), { wins: 0, losses: 1, ties: 0 });
});

test('settling twice does not record the game twice', () => {
  // Every ending path funnels through settleIfOver; a double call would
  // double a player's win on one game (the S22 claim-before-act shape).
  const guildId = freshGuildId();
  const game = session({ guildId });
  game.accepted = true;
  for (const c of [0, 6, 1, 6, 2, 6, 3]) game.state = playColumn(game.state, c);
  settleIfOver(game);
  settleIfOver(game);
  settleIfOver(game);
  assert.equal(getStats(guildId).played, 1);
  assert.equal(playerStats(getStats(guildId), HUMAN_A.id).wins, 1);
});

test('an unfinished game records nothing', () => {
  const guildId = freshGuildId();
  const game = session({ guildId });
  game.accepted = true;
  game.state = playColumn(game.state, 3);
  settleIfOver(game);
  assert.equal(getStats(guildId).played, 0);
  assert.equal(game.finished, false);
});

test('games against the bot stay off the scoreboard', () => {
  const guildId = freshGuildId();
  const game = session({ guildId, players: [HUMAN_A, BOT], againstBot: true });
  for (const c of [0, 6, 1, 6, 2, 6, 3]) game.state = playColumn(game.state, c);
  settleIfOver(game);
  assert.equal(getStats(guildId).played, 0, 'a human record is only meaningful against humans');
  assert.equal(game.finished, true, 'but the game is still over');
});

test('a tie credits both players a tie, and the guild counter', () => {
  const guildId = freshGuildId();
  recordResult(guildId, { tie: [HUMAN_A.id, HUMAN_B.id] });
  const all = getStats(guildId);
  assert.equal(all.played, 1);
  assert.equal(all.ties, 1);
  assert.equal(playerStats(all, HUMAN_A.id).ties, 1);
  assert.equal(playerStats(all, HUMAN_B.id).ties, 1);
});

test('existing scores survive the module swap — the storage key is unchanged', () => {
  // Deleting the old connect4 module must not reset anybody's record, so the
  // new service reads and writes the key the OLD module used. The expected
  // value is typed out here rather than imported, so it can actually disagree
  // with the code (S111 / skill 0.5.35).
  assert.equal(STATS_KEY, 'connect4Stats');

  // And prove it end-to-end: data written under the old key by a pre-swap
  // game is what the new service reads back.
  const guildId = freshGuildId();
  setGuildData(guildId, 'connect4Stats', {
    played: 7,
    ties: 1,
    players: { [HUMAN_A.id]: { wins: 5, losses: 1, ties: 1 } },
  });
  const carried = getStats(guildId);
  assert.equal(carried.played, 7);
  assert.deepEqual(playerStats(carried, HUMAN_A.id), { wins: 5, losses: 1, ties: 1 });

  // A new result adds to the old total instead of starting over.
  recordResult(guildId, { winnerId: HUMAN_A.id, loserId: HUMAN_B.id });
  assert.equal(getStats(guildId).played, 8);
  assert.equal(playerStats(getStats(guildId), HUMAN_A.id).wins, 6);
});

test('the leaderboard sorts by wins, then by fewest losses', () => {
  const guildId = freshGuildId();
  const C = '444444444444444444';
  recordResult(guildId, { winnerId: HUMAN_A.id, loserId: C });
  recordResult(guildId, { winnerId: HUMAN_A.id, loserId: C });
  recordResult(guildId, { winnerId: HUMAN_B.id, loserId: C });
  recordResult(guildId, { winnerId: C, loserId: HUMAN_B.id });

  const rows = leaderboard(guildId);
  assert.equal(rows[0].id, HUMAN_A.id, '2 wins');
  assert.equal(rows[0].wins, 2);
  assert.equal(rows[1].id, HUMAN_B.id, '1 win, 1 loss beats 1 win, 3 losses');
  assert.equal(rows[2].id, C);
});

test('an empty leaderboard is empty, not an error', () => {
  assert.deepEqual(leaderboard(freshGuildId()), []);
});
