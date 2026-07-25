// Wordle guess watcher (S83): typed messages from a player with a running
// game in THIS channel, cog-faithfully — wrong-shaped messages are silently
// ignored, unknown words get ❌ + a self-deleting notice and cost nothing,
// accepted guesses re-render the board in place. Needs the Message Content
// intent (the play sub refuses to start without it).
import { Events } from 'discord.js';
import { boardComponents, boardEmbed, finishCancel, finishTimeout } from '../commands/wordle.js';
import { armGuessTimer, endWordleGame, getWordleGame, recordFinished, submitGuess } from '../service.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author?.bot || !message.guild) return;
    const game = getWordleGame(message.guild.id, message.author.id);
    if (!game || game.channelId !== message.channel.id) return;

    const result = submitGuess(game, message.content.trim());
    if (result.code === 'ended' || result.code === 'ignored') return;

    if (result.code === 'cancel') {
      await finishCancel(game);
      return;
    }

    if (result.code === 'invalid') {
      // The cog: ❌ reaction + a notice that deletes itself after 3 s; the
      // attempt is NOT used and its 5-minute clock restarted.
      armGuessTimer(game, () => finishTimeout(game));
      await message.react('❌').catch(() => {});
      const notice = await message
        .reply({ content: 'This word is not a valid word in the dictionary.', allowedMentions: { repliedUser: false } })
        .catch(() => null);
      if (notice) {
        const timer = setTimeout(() => notice.delete().catch(() => {}), 3000);
        timer.unref?.();
      }
      return;
    }

    // accepted
    const author = {
      name: message.member?.displayName ?? message.author.username,
      iconURL: message.author.displayAvatarURL(),
    };
    const done = result.won || result.lost;
    if (done) {
      recordFinished(game.guildId, game.userId, { won: result.won, attemptsUsed: game.attempts.length });
      endWordleGame(game);
    } else {
      armGuessTimer(game, () => finishTimeout(game));
    }
    await game.message
      ?.edit({
        embeds: [boardEmbed(game, author, message.guild)],
        components: boardComponents(game, { disabled: done }),
      })
      .catch(() => {});
  },
};
