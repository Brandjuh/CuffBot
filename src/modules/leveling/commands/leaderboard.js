// S93 (M17.3 slice A): converted to the flat { command } shape. The `size`
// bounds that used to be setMinValue/setMaxValue on the slash builder are now
// min/max on the arg spec, so `!leaderboard 99` still gets a straight answer.
// The footer's stale "/level" is fixed too — S68 made the bot text-only.
import { EmbedBuilder } from 'discord.js';
import { leaderboard } from '../service.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  command: {
    name: 'leaderboard',
    description: 'Top of the force: the precinct XP leaderboard.',
    emoji: '🏆',
    args: [{ name: 'size', type: 'integer', min: 1, max: 25 }], // default 10
    async run(ctx, { size = 10 }) {
      const top = leaderboard(ctx.guild.id, size);

      const embed = new EmbedBuilder().setColor(0xd4a24e).setTitle('🏆 Precinct Leaderboard');
      if (top.length === 0) {
        embed.setDescription(
          'No XP on the books yet. XP starts flowing as members chat and spend time in voice.',
        );
      } else {
        embed.setDescription(
          top
            .map((row, i) => {
              const place = MEDALS[i] ?? `**${i + 1}.**`;
              return `${place} <@${row.userId}> — ${row.xp.toLocaleString('en-US')} XP`;
            })
            .join('\n'),
        );
        embed.setFooter({
          text: `Message + voice activity both count. ${ctx.prefix}level shows your own card.`,
        });
      }
      await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
};
