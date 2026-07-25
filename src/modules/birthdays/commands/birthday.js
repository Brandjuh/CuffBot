// The birthday-announcements admin group (S70 = M17.2, `!birthday` — the old
// `!birthday-config` name stays as an alias). Members use !birthday-set.
import { PermissionFlagsBits } from 'discord.js';
import { getBirthdayConfig, setBirthdayConfig } from '../service.js';

export default {
  group: {
    name: 'birthday',
    aliases: ['birthday-config'],
    description: 'Birthday announcements: channel and the birthday role (admin).',
    emoji: '🎂',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getBirthdayConfig(ctx.guild.id);
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set — nothing is announced until an admin picks one'}`,
        `**Birthday role:** ${config.birthdayRoleId ? `<@&${config.birthdayRoleId}> — worn for the celebrant's whole (local) birthday` : 'none'}`,
        '',
        `Members register with \`${ctx.prefix}birthday-set\` (own timezone supported); the sweep checks every ~10 minutes, announces on the member’s own calendar day, once per year.`,
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Turn birthday announcements on.',
        args: [],
        async run(ctx) {
          setBirthdayConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ Birthday announcements are **on**.');
        },
      },
      {
        name: 'off',
        description: 'Turn birthday announcements off.',
        args: [],
        async run(ctx) {
          setBirthdayConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 Birthday announcements are **off**.');
        },
      },
      {
        name: 'channel',
        description: 'Channel where birthdays are announced.',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setBirthdayConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ Birthdays are announced in <#${channel.id}>.`);
        },
      },
      {
        name: 'role',
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
