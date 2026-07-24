import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  DEFAULT_TIMEZONE,
  formatBirthday,
  isValidTimeZone,
  parseBirthdayDate,
  suggestTimeZones,
} from '../lib/birthday.js';
import { setBirthday } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('birthday-set')
    .setDescription('Register your birthday so the precinct can celebrate you.')
    .addStringOption((o) =>
      o
        .setName('date')
        .setDescription('Your birthday as YYYY/MM/DD — e.g. 1990/05/23')
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('timezone')
        .setDescription(`Start typing to pick your timezone from the list (default: ${DEFAULT_TIMEZONE})`)
        .setAutocomplete(true),
    ),
  // S44: the timezone option suggests from the FULL IANA list as you type
  // (a plain dropdown caps at 25 options; autocomplete does not).
  async autocomplete(interaction) {
    const query = interaction.options.getFocused();
    await interaction.respond(suggestTimeZones(query).map((zone) => ({ name: zone, value: zone })));
  },
  async execute(interaction) {
    const input = interaction.options.getString('date', true);
    const timeZone = interaction.options.getString('timezone') ?? DEFAULT_TIMEZONE;

    const parsed = parseBirthdayDate(input);
    if (!parsed) {
      await interaction.reply({
        content:
          `🚫 \`${input}\` doesn’t parse, officer. Use **YYYY/MM/DD** — e.g. \`1990/05/23\` — ` +
          'and make it a real calendar date (year 1900 or later, no time travel).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!isValidTimeZone(timeZone)) {
      await interaction.reply({
        content:
          `🚫 \`${timeZone}\` is not a timezone I know. Start typing in the option to pick one from the list, ` +
          'or use an IANA name like `America/New_York`, `America/Chicago`, `Europe/Amsterdam`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const record = { day: parsed.day, month: parsed.month, year: parsed.year, timeZone };
    setBirthday(interaction.guild.id, interaction.user.id, record);
    await interaction.reply({
      content:
        `🎂 Noted: your birthday is **${formatBirthday(record)}** (born ${parsed.year}, timezone **${timeZone}**). ` +
        'The precinct will be informed on the day — the year stays private. Remove it any time with `/birthday-remove`.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
