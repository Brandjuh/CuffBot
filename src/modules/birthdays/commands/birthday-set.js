import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { DEFAULT_TIMEZONE, formatBirthday, isValidBirthday, isValidTimeZone } from '../lib/birthday.js';
import { setBirthday } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('birthday-set')
    .setDescription('Register your birthday so the precinct can celebrate you.')
    .addIntegerOption((o) =>
      o.setName('day').setDescription('Day of the month (1–31)').setRequired(true).setMinValue(1).setMaxValue(31),
    )
    .addIntegerOption((o) =>
      o.setName('month').setDescription('Month (1–12)').setRequired(true).setMinValue(1).setMaxValue(12),
    )
    .addStringOption((o) =>
      o
        .setName('timezone')
        .setDescription(`IANA timezone, e.g. Europe/Amsterdam or America/New_York (default: ${DEFAULT_TIMEZONE})`),
    ),
  async execute(interaction) {
    const day = interaction.options.getInteger('day', true);
    const month = interaction.options.getInteger('month', true);
    const timeZone = interaction.options.getString('timezone') ?? DEFAULT_TIMEZONE;

    if (!isValidBirthday(day, month)) {
      await interaction.reply({
        content: `🚫 ${day}-${month} is not a real calendar date, officer. Nice try.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!isValidTimeZone(timeZone)) {
      await interaction.reply({
        content:
          `🚫 \`${timeZone}\` is not a timezone I know. Use an IANA name like ` +
          '`Europe/Amsterdam`, `Europe/London`, `America/New_York`, `America/Los_Angeles`, `Asia/Tokyo`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const record = { day, month, timeZone };
    setBirthday(interaction.guild.id, interaction.user.id, record);
    await interaction.reply({
      content:
        `🎂 Noted: your birthday is **${formatBirthday(record)}** (timezone **${timeZone}**). ` +
        'The precinct will be informed on the day. Remove it any time with `/birthday-remove`.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
