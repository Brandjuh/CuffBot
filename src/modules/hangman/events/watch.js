// Hangman guess watcher (S72): single typed letters from the player who
// started the game, cog-faithfully — repeats are free, wrong guesses draw the
// gallows, the 6th wrong guess ends it. Needs the Message Content intent
// (the play sub refuses to start without it).
import { Events } from 'discord.js';
import { applyGuess, isLetter, renderBoard } from '../lib/game.js';
import { armGuessTimer, endHangman, getHangmanConfig, getHangmanGame } from '../service.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deliver the next board state: edit in place (doEdit) or send a new message. */
async function postBoard(game, message, text, { doEdit }) {
  if (doEdit && game.boardMessage?.edit) {
    await game.boardMessage.edit(text).catch(() => {});
    return;
  }
  const sent = await message.channel.send(text).catch(() => null);
  if (sent) game.boardMessage = sent;
}

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author?.bot || !message.guild) return;
    const game = getHangmanGame(message.channel.id);
    if (!game || message.author.id !== game.playerId) return;
    if (!isLetter(message.content)) return;

    const { doEdit } = getHangmanConfig(message.guild.id);
    if (doEdit) {
      // The cog waits 200 ms, then tidies the guess away; missing Manage
      // Messages (or an already-deleted message) is silently fine.
      await sleep(200);
      await message.delete().catch(() => {});
    }

    const outcome = applyGuess(game, message.content);
    if (outcome === 'won' || outcome === 'lost') {
      endHangman(game.channelId);
      await postBoard(game, message, renderBoard(game, { outcome }), { doEdit });
      return;
    }
    armGuessTimer(game, async () => {
      endHangman(game.channelId);
      await message.channel
        .send(`Canceling selection. You took too long.\nThe word was ${game.word}.`)
        .catch(() => {});
    });
    await postBoard(game, message, renderBoard(game, { repeat: outcome === 'repeat' }), { doEdit });
  },
};
