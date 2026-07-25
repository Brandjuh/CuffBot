// S94 (M17.3 slice B): converted to the flat { command } shape.
//
// The S44 `autocomplete` handler is gone: it could only ever fire for a slash
// option, and S68 removed every slash command, so it has been dead code since.
// `suggestTimeZones` survives and does more useful work now — a mistyped zone
// gets the closest real names back instead of a bare refusal.
import {
  DEFAULT_TIMEZONE,
  formatBirthday,
  isValidTimeZone,
  parseBirthdayDate,
  suggestTimeZones,
} from '../lib/birthday.js';
import { setBirthday } from '../service.js';

export default {
  command: {
    name: 'birthday-set',
    description: 'Register your birthday so the precinct can celebrate you.',
    emoji: '🎂',
    args: [
      { name: 'date', type: 'string', required: true }, // YYYY/MM/DD
      { name: 'timezone', type: 'string' }, // IANA name; default below
    ],
    async run(ctx, { date: input, timezone = DEFAULT_TIMEZONE }) {
      const parsed = parseBirthdayDate(input);
      if (!parsed) {
        await ctx.reply(
          `🚫 \`${input}\` doesn’t parse, officer. Use **YYYY/MM/DD** — e.g. \`1990/05/23\` — ` +
            'and make it a real calendar date (year 1900 or later, no time travel).',
        );
        return;
      }
      if (!isValidTimeZone(timezone)) {
        const near = suggestTimeZones(timezone).slice(0, 5);
        const hint = near.length
          ? `Did you mean ${near.map((z) => `\`${z}\``).join(', ')}?`
          : 'Use an IANA name like `America/New_York`, `America/Chicago`, `Europe/Amsterdam`.';
        await ctx.reply(`🚫 \`${timezone}\` is not a timezone I know. ${hint}`);
        return;
      }

      const record = { day: parsed.day, month: parsed.month, year: parsed.year, timeZone: timezone };
      setBirthday(ctx.guild.id, ctx.user.id, record);
      await ctx.reply(
        `🎂 Noted: your birthday is **${formatBirthday(record)}** (born ${parsed.year}, timezone **${timezone}**). ` +
          `The precinct will be informed on the day — the year stays private. Remove it any time with \`${ctx.prefix}birthday-remove\`.`,
      );
    },
  },
};
