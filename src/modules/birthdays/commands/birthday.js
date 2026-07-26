// The birthday group (`!birthday`; the retired `!birthday-config` name stays
// an alias). S106 folded the member commands in: `!birthday set` and
// `!birthday remove` are now `set` and `remove`, so one family is one command.
//
// The group itself is UNGATED — members must be able to register — and each
// admin subcommand carries the Manage Server flag instead. The overview
// filters per viewer, so a member sees only `set` and `remove`.
import { PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_TIMEZONE,
  formatBirthday,
  isValidTimeZone,
  parseBirthdayDate,
  suggestTimeZones,
} from '../lib/birthday.js';
import { getBirthdayConfig, removeBirthday, setBirthday, setBirthdayConfig } from '../service.js';

export default {
  group: {
    name: 'birthday',
    aliases: ['birthday-config', 'birthday-set', 'birthday-remove'],
    description: 'Birthdays: register your own, and (admins) the announcement channel and role.',
    emoji: '🎂',
    status(ctx) {
      const config = getBirthdayConfig(ctx.guild.id);
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set — nothing is announced until an admin picks one'}`,
        `**Birthday role:** ${config.birthdayRoleId ? `<@&${config.birthdayRoleId}> — worn for the celebrant's whole (local) birthday` : 'none'}`,
        '',
        `Members register with \`${ctx.prefix}birthday set\` (own timezone supported); the sweep checks every ~10 minutes, announces on the member’s own calendar day, once per year.`,
      ];
    },
    subcommands: [
      {
        // S106: was `!birthday set`.
        name: 'set',
        aliases: ['add', 'mine'],
        description: 'Register your birthday (day + month; the year is never stored).',
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
              `The precinct will be informed on the day — the year stays private. Remove it any time with \`${ctx.prefix}birthday remove\`.`,
          );
        },
      },
      {
        // S106: was `!birthday remove`.
        name: 'remove',
        aliases: ['delete', 'clear'],
        description: 'Remove your stored birthday (no more announcements).',
        args: [],
        async run(ctx) {

          const existed = removeBirthday(ctx.guild.id, ctx.user.id);
          await ctx.reply(
            existed
              ? '🗑️ Your birthday has been struck from the record. No cake, no candles, no announcement.'
              : 'ℹ️ There was no birthday on file for you.',
          );
        },
      },
      {
        name: 'on',
        permission: PermissionFlagsBits.ManageGuild,
        description: 'Turn birthday announcements on.',
        args: [],
        async run(ctx) {
          setBirthdayConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ Birthday announcements are **on**.');
        },
      },
      {
        name: 'off',
        permission: PermissionFlagsBits.ManageGuild,
        description: 'Turn birthday announcements off.',
        args: [],
        async run(ctx) {
          setBirthdayConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 Birthday announcements are **off**.');
        },
      },
      {
        name: 'channel',
        permission: PermissionFlagsBits.ManageGuild,
        description: 'Channel where birthdays are announced.',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setBirthdayConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ Birthdays are announced in <#${channel.id}>.`);
        },
      },
      {
        name: 'role',
        permission: PermissionFlagsBits.ManageGuild,
        aliases: ['birthday-role'],
        description: 'Role celebrants wear for their whole birthday.',
        args: [{ name: 'role', type: 'role', required: true }],
        async run(ctx, { role }) {
          setBirthdayConfig(ctx.guild.id, { birthdayRoleId: role.id });
          await ctx.reply(`✅ Celebrants wear <@&${role.id}> for their whole birthday.`);
        },
      },
      {
        name: 'norole',
        permission: PermissionFlagsBits.ManageGuild,
        aliases: ['no-birthday-role'],
        description: 'Stop handing out a birthday role.',
        args: [],
        async run(ctx) {
          setBirthdayConfig(ctx.guild.id, { birthdayRoleId: null });
          await ctx.reply('✅ No birthday role is handed out.');
        },
      },
    ],
  },
};
