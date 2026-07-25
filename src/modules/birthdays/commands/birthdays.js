// S94 (M17.3 slice B): converted to the flat { command } shape. Two stale
// pointers fixed while here: the empty-list hint still advertised the
// pre-S44 `day:`/`month:` options, and the footer still said `/birthday-set`
// although slash commands went away in S68.
import { EmbedBuilder } from 'discord.js';
import { formatBirthday, nextBirthdays } from '../lib/birthday.js';
import { getBirthdayUsers } from '../service.js';

export default {
  command: {
    name: 'birthdays',
    description: 'Show the next upcoming birthdays in the precinct.',
    emoji: '🎂',
    args: [{ name: 'count', type: 'integer', min: 1, max: 15 }], // default 5
    async run(ctx, { count = 5 }) {
      const users = getBirthdayUsers(ctx.guild.id);
      const upcoming = nextBirthdays(users, Date.now(), count);

      const embed = new EmbedBuilder().setColor(0xdb6ea4).setTitle('🎂 Upcoming Birthdays');
      if (upcoming.length === 0) {
        embed.setDescription(
          `No birthdays on file yet. Register yours with \`${ctx.prefix}birthday-set 1990/05/23\` — the precinct loves cake.`,
        );
      } else {
        embed.setDescription(
          upcoming
            .map(({ userId, record, daysUntil }) => {
              const when =
                daysUntil === 0 ? '**TODAY** 🎉' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
              return `<@${userId}> — ${formatBirthday(record)} (${when})`;
            })
            .join('\n'),
        );
        embed.setFooter({
          text: `Days count in each member’s own timezone · ${ctx.prefix}birthday-set to join the list`,
        });
      }
      await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
};
