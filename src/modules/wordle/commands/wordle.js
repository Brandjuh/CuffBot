// The !wordle group (S83 = M16.10, AAA3A wordlegame port): guess the secret
// word by TYPING guesses in the channel — the emoji grid replaces the cog's
// PNG board, edited in place instead of delete+repost (attachment artifact).
// English lists only (survey decision); lengths 4–11, attempts 5–10.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  ATTEMPTS_MAX,
  ATTEMPTS_MIN,
  DEFAULT_ATTEMPTS,
  DEFAULT_LENGTH,
  LENGTH_MAX,
  LENGTH_MIN,
  renderGrid,
} from '../lib/game.js';
import {
  armGuessTimer,
  createWordleGame,
  endWordleGame,
  getWordleGame,
  getWordleStats,
  recordFinished,
} from '../service.js';

const TEAL = 0x11806a;

export function boardEmbed(game, author, guild) {
  const embed = new EmbedBuilder()
    .setColor(TEAL)
    .setTitle(`🇬🇧 Wordle Game - ${game.attempts.length}/${game.maxAttempts} attempts`)
    .setDescription(renderGrid(game.word, game.attempts, game.maxAttempts))
    .setAuthor(author)
    .setFooter({ text: guild.name, iconURL: guild.iconURL?.() ?? undefined });
  if (game.won || game.lost) {
    embed.addFields({
      name: game.won ? 'You won!' : 'You lost!',
      value: `The word was: **${game.word}**.`,
    });
  }
  return embed;
}

export function boardComponents(game, { disabled = false } = {}) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`wd:explain:${game.id}`)
        .setLabel('Explanation')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`wd:cancel:${game.id}`)
        .setEmoji('✖️')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
  ];
}

const noPing = { allowedMentions: { repliedUser: false } };

/** Shared cancel ending (typed `cancel`, the ✖️ button): cog line + stats. */
export async function finishCancel(game) {
  recordFinished(game.guildId, game.userId, { won: false });
  endWordleGame(game);
  await game.message?.edit({ components: boardComponents(game, { disabled: true }) }).catch(() => {});
  await game.message
    ?.reply({ content: `You have cancelled the game. The word was: **${game.word}**.`, ...noPing })
    .catch(() => {});
}

/** The 5-minute guess timeout ending (cog's wait_for TimeoutError path). */
export async function finishTimeout(game) {
  recordFinished(game.guildId, game.userId, { won: false });
  endWordleGame(game);
  await game.message?.edit({ components: boardComponents(game, { disabled: true }) }).catch(() => {});
  await game.message
    ?.reply({ content: `You took too long to guess the word. The word was: **${game.word}**.`, ...noPing })
    .catch(() => {});
}

export const EXPLANATION =
  'The game is simple, you have to guess a word in some attempts. A word is chosen randomly from a dictionary of words with a specific length. The game ends when you guess the word or when you reach the maximum number of attempts.\n' +
  '• If the letter is **🟩 Green**, it is in the correct position.\n' +
  '• If the letter is **🟨 Yellow**, it is in the word but not in the correct position.\n' +
  '• If the letter is **⬛ Grey**, it is not in the word.\n' +
  'You can cancel the game at any time by clicking on the button or typing `cancel`.\n\n' +
  '**Launch a new game by executing `!wordle play`!**\n' +
  'English words only; lengths 4–11.';

export default {
  group: {
    name: 'wordle',
    aliases: ['wordlegame'],
    description: 'Wordle: guess the secret word — type your guesses right in the channel.',
    emoji: '🟩',
    fallback: 'play', // `!wordle 6` reads like the cog's `!wordle en 6`
    status(ctx) {
      const mine = getWordleStats(ctx.guild.id, ctx.user.id);
      const open = getWordleGame(ctx.guild.id, ctx.user.id);
      const intentLine = ctx.client.messageContentAvailable
        ? '✅ Typed guesses are heard (Message Content intent active).'
        : '⚠️ **Message Content intent OFF** — the bot cannot read guesses, games cannot run.';
      return [
        `Start with \`${ctx.prefix}wordle play [length] [attempts]\` (word length ${LENGTH_MIN}–${LENGTH_MAX}, default ${DEFAULT_LENGTH}; attempts ${ATTEMPTS_MIN}–${ATTEMPTS_MAX}, default ${DEFAULT_ATTEMPTS}), then TYPE your guesses in the channel — 🟩 right spot, 🟨 in the word, ⬛ not in it. Words must be real (English); a wrong word costs nothing. Type \`cancel\` to give up; 5 minutes of silence ends the game.`,
        '',
        ...(mine.games > 0
          ? [
              `**Your record:** ${mine.wins} win${mine.wins === 1 ? '' : 's'} in ${mine.games} game${mine.games === 1 ? '' : 's'} (${((mine.wins / mine.games) * 100).toFixed(2)}%)`,
            ]
          : []),
        open ? `**You:** mid-game in <#${open.channelId}> — one game per officer.` : '**You:** free to play.',
        intentLine,
      ];
    },
    subcommands: [
      {
        name: 'play',
        aliases: ['start'],
        description: `Start a game (length ${LENGTH_MIN}–${LENGTH_MAX}, attempts ${ATTEMPTS_MIN}–${ATTEMPTS_MAX}).`,
        args: [
          { name: 'length', type: 'integer', required: false },
          { name: 'attempts', type: 'integer', required: false },
        ],
        async run(ctx, { length, attempts }) {
          if (!ctx.client.messageContentAvailable) {
            await ctx.reply('🚫 The Message Content intent is off — I cannot read typed guesses, so Wordle cannot run.');
            return;
          }
          const chosenLength = length ?? DEFAULT_LENGTH;
          const chosenAttempts = attempts ?? DEFAULT_ATTEMPTS;
          if (chosenLength < LENGTH_MIN || chosenLength > LENGTH_MAX) {
            await ctx.reply(`🚫 The word length must be ${LENGTH_MIN}–${LENGTH_MAX}.`);
            return;
          }
          if (chosenAttempts < ATTEMPTS_MIN || chosenAttempts > ATTEMPTS_MAX) {
            await ctx.reply(`🚫 The attempts must be ${ATTEMPTS_MIN}–${ATTEMPTS_MAX}.`);
            return;
          }
          const result = createWordleGame(ctx.guild.id, ctx.channel.id, ctx.user.id, {
            length: chosenLength,
            maxAttempts: chosenAttempts,
          });
          if (result.error === 'busy') {
            await ctx.reply('🚫 You already have a Wordle game running — finish it or type `cancel` in its channel.');
            return;
          }
          if (result.error === 'no-words') {
            await ctx.reply(`There are no words in this language with ${chosenLength} letters.`);
            return;
          }
          const game = result.game;
          const message = await ctx.reply({
            embeds: [
              boardEmbed(game, { name: ctx.member?.displayName ?? ctx.user.username, iconURL: ctx.user.displayAvatarURL() }, ctx.guild),
            ],
            components: boardComponents(game),
          });
          if (!message) {
            endWordleGame(game);
            return;
          }
          game.message = message;
          armGuessTimer(game, () => finishTimeout(game));
        },
      },
      {
        name: 'stats',
        aliases: ['statistics'],
        description: 'Wordle stats for you or another officer: games, wins, guess distribution.',
        args: [{ name: 'member', type: 'user', required: false }],
        async run(ctx, { member }) {
          const target = member ?? ctx.user;
          const stats = getWordleStats(ctx.guild.id, target.id);
          const winRate = stats.games ? ((stats.wins / stats.games) * 100).toFixed(2) : '0.00';
          const embed = new EmbedBuilder()
            .setColor(TEAL)
            .setTitle('Wordle Game Stats')
            .setDescription(`>>> **Games played**: ${stats.games}\n**Wins**: ${stats.wins}\n**Win rate:** ${winRate}%`)
            .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: ctx.guild.name, iconURL: ctx.guild.iconURL?.() ?? undefined });
          const lines = stats.distribution
            .map((count, i) => ({ count, attempts: i + 1 }))
            .filter(({ count }) => count > 0)
            .map(({ count, attempts }) => `- **${count}** guess${count > 1 ? 'es' : ''} with ${attempts} attempts`);
          if (lines.length > 0) embed.addFields({ name: 'Guess distribution:', value: lines.join('\n') });
          await ctx.reply({ embeds: [embed] });
        },
      },
    ],
  },
};
