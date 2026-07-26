// The !guessthecandy group (S80 = M16.7, AAA3A port): a speed round — the
// scrambled candy name in a code block, 5–23 name buttons, first correct
// press wins on the clock. `play` is the fallback sub, so `!gtc 8` works.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { DEFAULT_DIFFICULTY, MAX_DIFFICULTY, MIN_DIFFICULTY } from '../lib/game.js';
import { armCandyTimer, createCandyGame, endCandyGame } from '../service.js';

const ORANGE = 0xe67e22;

export function candyComponents(game, { disabled = false } = {}) {
  const rows = []; // 23 candies max = 5 rows of 5 — inside Discord's limits
  for (let start = 0; start < game.candies.length; start += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        game.candies.slice(start, start + 5).map((candy, offset) =>
          new ButtonBuilder()
            .setCustomId(`gtc:${game.id}:${start + offset}`)
            .setLabel(candy)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
        ),
      ),
    );
  }
  return rows;
}

export function candyEmbed(game) {
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('🍬 Guess The Candy 🍬')
    .setDescription(
      [
        'Recognise the correct candy as fast as you can, from the scrambled name!',
        '',
        `\`\`\`${game.scrambled}\`\`\``,
      ].join('\n'),
    );
}

export default {
  group: {
    name: 'guessthecandy',
    aliases: ['gtc'],
    description: 'Guess the candy: unscramble the name and hit the right button first.',
    emoji: '🍬',
    fallback: 'play',
    status(ctx) {
      return [
        `Start a round with \`${ctx.prefix}gtc\` (or \`${ctx.prefix}gtc 12\` for more buttons, ${MIN_DIFFICULTY}–${MAX_DIFFICULTY}). The scrambled candy name appears; the first officer to press the right name wins — the clock runs to two decimals. Wrong presses are free; rounds close after 3 minutes. Multiple rounds can run at once.`,
      ];
    },
    // S117: the source cog is a PLAIN command — `[p]guessthecandy` starts a game.
    // Ours was a group from birth (S72–S83), so the S106 sweep that added
    // `invokeWithoutSubcommand` never looked at it and bare `!guessthecandy` answered
    // with a menu instead of playing. `!guessthecandy help` still lists the family.
    invokeWithoutSubcommand: true,
    fallback: 'play',
    subcommands: [
      {
        name: 'play',
        aliases: ['start'],
        description: `Start a round (difficulty = number of buttons, ${MIN_DIFFICULTY}–${MAX_DIFFICULTY}).`,
        args: [{ name: 'difficulty', type: 'integer', required: false }],
        async run(ctx, { difficulty }) {
          const count = difficulty ?? DEFAULT_DIFFICULTY;
          if (count < MIN_DIFFICULTY || count > MAX_DIFFICULTY) {
            await ctx.reply(`🚫 Difficulty must be ${MIN_DIFFICULTY}–${MAX_DIFFICULTY} (buttons on the board).`);
            return;
          }
          const game = createCandyGame(ctx.channel.id, ctx.guild.id, { difficulty: count });
          const message = await ctx.reply({ embeds: [candyEmbed(game)], components: candyComponents(game) });
          if (!message) {
            endCandyGame(game.id);
            return;
          }
          game.message = message;
          game.startedAt = Date.now(); // the clock starts after the send (cog behavior)
          armCandyTimer(game, async () => {
            endCandyGame(game.id);
            await message.edit({ components: candyComponents(game, { disabled: true }) }).catch(() => {});
          });
        },
      },
    ],
  },
};
