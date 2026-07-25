// Hangman (S72 = M16.4, FlameCogs port): the byte-faithful frames and mask,
// the guess state machine, the bundled wordlist, the service, and the group
// wiring — plus an end-to-end guess flow through the watcher with fakes.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import {
  GALLOWS,
  MAX_FAILS,
  applyGuess,
  isLetter,
  isWon,
  loadWords,
  maskWord,
  pickWord,
  renderBoard,
} from '../src/modules/hangman/lib/game.js';
import {
  clearAllHangmanGames,
  endHangman,
  getHangmanConfig,
  getHangmanGame,
  setHangmanConfig,
  startHangman,
} from '../src/modules/hangman/service.js';
import hangmanCommand from '../src/modules/hangman/commands/hangman.js';
import watch from '../src/modules/hangman/events/watch.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-hangman-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  clearAllHangmanGames();
});

let seq = 0;
const freshGuildId = () => `72000000000000${String((seq += 1)).padStart(4, '0')}`;
const freshChannelId = () => `hm-chan-${seq}`;

// ── pure rules ───────────────────────────────────────────────────────────────

test('the gallows are the cog’s seven frames, byte for byte at the joints', () => {
  assert.equal(GALLOWS.length, 7);
  assert.match(GALLOWS[0], /\|   O   \n/, 'head appears from frame 0');
  assert.ok(!GALLOWS[0].includes('\\'), 'no arms yet');
  assert.match(GALLOWS[2], /\|  \\\|  \n/, 'left arm frame keeps the cog’s spacing');
  assert.match(GALLOWS[3], /\|  \\\|\/ \n/, 'both arms');
  assert.match(GALLOWS[5], /\|  \/ \\ \n/, 'both legs');
  assert.match(GALLOWS[6], /\|   X   \n/, 'dead frame swaps O for X');
  for (const frame of GALLOWS) {
    assert.equal(frame.split('\n').length, 8, 'seven lines + trailing newline');
    assert.match(frame, /^ {4}___ {4}\n/, 'the beam line is exact');
  }
});

test('maskWord renders the cog format: blanks, reveals, non-letters, wrong list', () => {
  assert.equal(maskWord('cop', ''), '_ _ _     ()');
  assert.equal(maskWord('cop', 'oxz'), '_ o _     (xz)');
  assert.equal(maskWord("o'clock", 'oc'), "o ' c _ o c _     ()", 'non-letters auto-revealed');
  assert.equal(maskWord('cop', 'cop'), 'c o p     ()');
});

test('applyGuess: repeats free, six wrong guesses lose, full word wins', () => {
  const state = { word: 'cop', guessed: '', fails: 0 };
  assert.equal(applyGuess(state, 'C'), 'good', 'uppercase input lowercased');
  assert.equal(applyGuess(state, 'c'), 'repeat');
  assert.equal(state.fails, 0, 'repeat costs nothing');
  assert.equal(applyGuess(state, 'x'), 'wrong');
  for (const l of 'qwrtz') {
    const outcome = applyGuess(state, l);
    assert.ok(outcome === 'wrong' || outcome === 'lost');
  }
  assert.equal(state.fails, MAX_FAILS, 'sixth wrong guess ends it');

  const winning = { word: "o'k", guessed: '', fails: 0 };
  applyGuess(winning, 'o');
  assert.equal(applyGuess(winning, 'k'), 'won', 'non-letters never need guessing');
  assert.equal(isWon(winning.word, winning.guessed), true);
});

test('isLetter matches the cog check: exactly one a–z character', () => {
  assert.equal(isLetter('a'), true);
  assert.equal(isLetter('Q'), true);
  assert.equal(isLetter('ab'), false);
  assert.equal(isLetter('1'), false);
  assert.equal(isLetter(''), false);
});

test('renderBoard produces the cog’s exact end-state lines', () => {
  const state = { word: 'cop', guessed: 'co', fails: 2 };
  assert.match(renderBoard(state), /^```.*```Guess:$/s);
  assert.match(renderBoard(state, { repeat: true }), /```You already guessed that letter\.\nGuess:$/s);
  assert.match(renderBoard({ ...state, guessed: 'cop' }, { outcome: 'won' }), /```You win!\nThe word was cop\.$/s);
  assert.match(renderBoard({ ...state, fails: 6 }, { outcome: 'lost' }), /```Game Over\nThe word was cop\.$/s);
});

test('the bundled wordlist loads all 4,554 FlameCogs words', () => {
  const words = loadWords({ force: true });
  assert.equal(words.length, 4554);
  assert.ok(words.includes('aardvark'), 'first cog word present');
  assert.ok(words.every((w) => w === w.toLowerCase() && w.length > 0));
  assert.equal(pickWord(() => 0), words[0]);
  assert.equal(pickWord(() => 0.9999999), words.at(-1));
});

// ── service ──────────────────────────────────────────────────────────────────

test('one game per channel; config default doEdit=true', () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  assert.equal(getHangmanConfig(guildId).doEdit, true);
  const { game } = startHangman(channelId, guildId, 'player-1', { random: () => 0 });
  assert.equal(game.word, 'aardvark');
  assert.equal(startHangman(channelId, guildId, 'player-2').error, 'busy');
  assert.equal(getHangmanGame(channelId), game);
  endHangman(channelId);
  assert.equal(getHangmanGame(channelId), null);
});

// ── watcher end-to-end (fakes, doEdit=false → no delete/sleep path) ──────────

function fakeGuessMessage(game, content, authorId = game.playerId) {
  const sends = [];
  return {
    sends,
    content,
    author: { id: authorId, bot: false },
    guild: { id: game.guildId },
    channel: { id: game.channelId, send: async (p) => (sends.push(p), { edit: async () => {} }) },
    delete: async () => {},
  };
}

test('the watcher plays a whole game: guesses, repeat note, win line', async () => {
  const guildId = freshGuildId();
  setHangmanConfig(guildId, { doEdit: false }); // multi-message mode: assert via sends
  const channelId = freshChannelId();
  const { game } = startHangman(channelId, guildId, 'player-9', { random: () => 0 }); // aardvark

  const stranger = fakeGuessMessage(game, 'a', 'someone-else');
  await watch.execute(stranger);
  assert.equal(stranger.sends.length, 0, 'only the starter’s guesses count');

  const tooLong = fakeGuessMessage(game, 'aa');
  await watch.execute(tooLong);
  assert.equal(tooLong.sends.length, 0, 'multi-letter messages ignored');

  const good = fakeGuessMessage(game, 'a');
  await watch.execute(good);
  assert.match(good.sends[0], /a a _ _ _ a _ _/, 'both a’s revealed');

  const repeat = fakeGuessMessage(game, 'a');
  await watch.execute(repeat);
  assert.match(repeat.sends[0], /You already guessed that letter\./);
  assert.equal(game.fails, 0);

  const wrong = fakeGuessMessage(game, 'z');
  await watch.execute(wrong);
  assert.equal(game.fails, 1);
  assert.match(wrong.sends[0], /\(z\)/, 'wrong letter listed in parentheses');

  for (const l of 'rdvk') await watch.execute(fakeGuessMessage(game, l));
  assert.equal(getHangmanGame(channelId), null, 'game ended');
  // The final board went out on the last guess's channel.send.
});

test('the sixth wrong guess ends the game with the Game Over line', async () => {
  const guildId = freshGuildId();
  setHangmanConfig(guildId, { doEdit: false });
  const channelId = freshChannelId();
  const { game } = startHangman(channelId, guildId, 'p', { random: () => 0 }); // aardvark
  for (const l of 'qwxyz') await watch.execute(fakeGuessMessage(game, l));
  assert.equal(game.fails, 5);
  const last = fakeGuessMessage(game, 'j');
  await watch.execute(last);
  assert.match(last.sends[0], /Game Over\nThe word was aardvark\./);
  assert.equal(getHangmanGame(channelId), null);
});

// ── group wiring ─────────────────────────────────────────────────────────────

const group = hangmanCommand.group;
const sub = (name) => group.subcommands.find((s) => s.name === name);

function fakeCtx(guildId, channelId, { intent = true, userId = 'player-1' } = {}) {
  const replies = [];
  return {
    replies,
    prefix: '!',
    guild: { id: guildId },
    channel: { id: channelId },
    client: { messageContentAvailable: intent },
    user: { id: userId },
    reply: async (p) => (replies.push(typeof p === 'string' ? { content: p } : p), { reply: async () => {} }),
  };
}

test('!hangman group shape: public play/stop, admin-gated edit', () => {
  assert.equal(group.name, 'hangman');
  assert.deepEqual(group.subcommands.map((s) => s.name), ['play', 'stop', 'edit']);
  assert.equal(group.permission, undefined, 'the game is public');
  assert.equal(sub('edit').permission, PermissionFlagsBits.ManageGuild, 'only the board style is admin');
});

test('play starts a game (board posted), refuses busy channels and a missing intent', async () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();

  const noIntent = fakeCtx(guildId, channelId, { intent: false });
  await sub('play').run(noIntent);
  assert.match(noIntent.replies[0].content, /Message Content intent is off/);
  assert.equal(getHangmanGame(channelId), null, 'no unwinnable game started');

  const ctx = fakeCtx(guildId, channelId);
  await sub('play').run(ctx);
  assert.match(ctx.replies[0].content ?? ctx.replies[0], /```/, 'the gallows board is posted');
  assert.ok(getHangmanGame(channelId), 'game live');

  await sub('play').run(ctx);
  assert.match(ctx.replies[1].content, /already running/);
  endHangman(channelId);
});

test('stop reveals the word — starter only', async () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  const ctx = fakeCtx(guildId, channelId);
  await sub('play').run(ctx);
  const word = getHangmanGame(channelId).word;

  const other = fakeCtx(guildId, channelId, { userId: 'other' });
  await sub('stop').run(other);
  assert.match(other.replies[0].content, /Only the player who started/);
  assert.ok(getHangmanGame(channelId), 'still running');

  await sub('stop').run(ctx);
  assert.match(ctx.replies[1].content, new RegExp(`the word was \\*\\*${word}\\*\\*`));
  assert.equal(getHangmanGame(channelId), null);

  await sub('stop').run(ctx);
  assert.match(ctx.replies[2].content, /No game is running/);
});

test('the edit sub flips the per-guild board style', async () => {
  const guildId = freshGuildId();
  const ctx = fakeCtx(guildId, freshChannelId());
  await sub('edit').run(ctx, { state: false });
  assert.equal(getHangmanConfig(guildId).doEdit, false);
  await sub('edit').run(ctx, { state: true });
  assert.equal(getHangmanConfig(guildId).doEdit, true);
});
