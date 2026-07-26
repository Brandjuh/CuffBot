// The !hangman group (S72 = M16.4, FlameCogs port): start a solo game against
// the bot, guess by typing single letters in the channel. The board renders
// the cog's exact gallows frames and messages.
import { PermissionFlagsBits } from 'discord.js';
import { renderBoard } from '../lib/game.js';
import {
  GUESS_TIMEOUT_MS,
  armGuessTimer,
  endHangman,
  getHangmanConfig,
  getHangmanGame,
  setHangmanConfig,
  startHangman,
} from '../service.js';

export default {
  group: {
    name: 'hangman',
    description: 'Hangman against the bot: guess the word one typed letter at a time.',
    emoji: '🪢',
    status(ctx) {
      const config = getHangmanConfig(ctx.guild.id);
      const open = getHangmanGame(ctx.channel.id);
      const intentLine = ctx.client.messageContentAvailable
        ? '✅ Letter guesses are heard (Message Content intent active).'
        : '⚠️ **Message Content intent OFF** — the bot cannot read guesses, games cannot run.';
      return [
        `Start with \`${ctx.prefix}hangman play\` — then type single letters in the channel. 6 wrong guesses and the case goes cold; you get 60 s per guess.`,
        '',
        `**Board style:** ${config.doEdit ? 'one edited message (guesses are tidied away)' : 'a new message per guess'}`,
        open
          ? `**This channel:** <@${open.playerId}> is mid-game — one game per channel.`
          : '**This channel:** free.',
        intentLine,
      ];
    },
    // S117: the source cog is a PLAIN command — `[p]hangman` starts a game.
    // Ours was a group from birth (S72–S83), so the S106 sweep that added
    // `invokeWithoutSubcommand` never looked at it and bare `!hangman` answered
    // with a menu instead of playing. `!hangman help` still lists the family.
    invokeWithoutSubcommand: true,
    fallback: 'play',
    subcommands: [
      {
        name: 'play',
        aliases: ['start'],
        description: 'Start a game — the bot picks a word, you guess letters.',
        args: [],
        async run(ctx) {
          if (!ctx.client.messageContentAvailable) {
            await ctx.reply('🚫 The Message Content intent is off — I cannot read letter guesses, so hangman cannot run.');
            return;
          }
          const result = startHangman(ctx.channel.id, ctx.guild.id, ctx.user.id);
          if (result.error === 'busy') {
            await ctx.reply('🚫 A game is already running in this channel — one at a time.');
            return;
          }
          const game = result.game;
          const message = await ctx.reply(renderBoard(game));
          if (!message) {
            endHangman(ctx.channel.id);
            return;
          }
          game.boardMessage = message;
          armGuessTimer(game, async () => {
            endHangman(game.channelId);
            // The cog's exact timeout message.
            await game.boardMessage
              ?.reply?.({
                content: `Canceling selection. You took too long.\nThe word was ${game.word}.`,
                allowedMentions: { repliedUser: false },
              })
              .catch(() => {});
          });
        },
      },
      {
        name: 'stop',
        aliases: ['giveup'],
        description: 'Give up your running game (reveals the word).',
        args: [],
        async run(ctx) {
          const game = getHangmanGame(ctx.channel.id);
          if (!game) {
            await ctx.reply('ℹ️ No game is running in this channel.');
            return;
          }
          if (game.playerId !== ctx.user.id) {
            await ctx.reply('🚫 Only the player who started the game can stop it.');
            return;
          }
          endHangman(ctx.channel.id);
          await ctx.reply(`🏳️ Case closed unsolved — the word was **${game.word}**.`);
        },
      },
      {
        name: 'edit',
        description: 'One edited board message (on) or a new message per guess (off).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setHangmanConfig(ctx.guild.id, { doEdit: state });
          await ctx.reply(
            state
              ? '✅ Games play on a single, edited message (guess messages are tidied away).'
              : '✅ Games play on multiple messages.',
          );
        },
      },
    ],
  },
};

export { GUESS_TIMEOUT_MS };
