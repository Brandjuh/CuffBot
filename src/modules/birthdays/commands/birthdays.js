import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { formatBirthday, nextBirthdays } from '../lib/birthday.js';
import { getBirthdayUsers } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('birthdays')
    .setDescription('Show the next upcoming birthdays in the precinct.')
    .addIntegerOption((o) =>
      o.setName('count').setDescription('How many to show (default 5)').setMinValue(1).setMaxValue(15),
    ),
  async execute(interaction) {
    const count = interaction.options.getInteger('count') ?? 5;
    const users = getBirthdayUsers(interaction.guild.id);
    const upcoming = nextBirthdays(users, Date.now(), count);

    const embed = new EmbedBuilder().setColor(0xdb6ea4).setTitle('🎂 Upcoming Birthdays');
    if (upcoming.length === 0) {
      embed.setDescription(
        'No birthdays on file yet. Register yours with `/birthday-set day: month: [timezone:]` — the precinct loves cake.',
      );
    } else {
      embed.setDescription(
        upcoming
          .map(({ userId, record, daysUntil }) => {
            const when = daysUntil === 0 ? '**TODAY** 🎉' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
            return `<@${userId}> — ${formatBirthday(record)} (${when})`;
          })
          .join('\n'),
      );
      embed.setFooter({ text: 'Days count in each member’s own timezone · /birthday-set to join the list' });
    }
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
