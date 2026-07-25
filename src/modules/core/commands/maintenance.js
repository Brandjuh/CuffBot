// The !maintenance group (S74, owner request; S75 correction: the exempt
// party is the BOT owner — the application owner — not the guild owner).
// Only the bot owner can flip the switch: anyone else who could enable it
// would lock themselves out, so the gate matches the exemption exactly.
import { PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  getMaintenance,
  isBotOwner,
  setMaintenance,
} from '../../../core/maintenance.js';

async function requireBotOwner(ctx) {
  if (await isBotOwner(ctx.client, ctx.user.id)) return true;
  await ctx.reply('🚫 Only the bot owner can touch the maintenance switch.');
  return false;
}

export default {
  group: {
    name: 'maintenance',
    description: 'Maintenance mode: only the bot owner can use commands (bot-owner-only switch).',
    emoji: '🚧',
    permission: PermissionFlagsBits.Administrator,
    status(ctx) {
      const config = getMaintenance(ctx.guild.id);
      return [
        `**Maintenance mode:** ${config.enabled ? '🚧 ON — everyone except the bot owner gets the notice' : 'off — all commands open'}`,
        `**Notice:** ${config.message ?? `_(default)_ ${DEFAULT_MAINTENANCE_MESSAGE}`}`,
        '',
        '_Only the bot owner can flip the switch; events, sweeps, and running games are not affected — only commands are gated._',
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Close the command desk — only the bot owner can run commands.',
        args: [],
        async run(ctx) {
          if (!(await requireBotOwner(ctx))) return;
          setMaintenance(ctx.guild.id, { enabled: true });
          await ctx.reply('🚧 Maintenance mode is **ON** — everyone except you now gets the maintenance notice.');
        },
      },
      {
        name: 'off',
        description: 'Reopen the command desk for everyone.',
        args: [],
        async run(ctx) {
          if (!(await requireBotOwner(ctx))) return;
          setMaintenance(ctx.guild.id, { enabled: false });
          await ctx.reply('✅ Maintenance mode is **OFF** — CuffBot is back on duty for everyone.');
        },
      },
      {
        name: 'message',
        description: 'Set a custom maintenance notice (shown to everyone but you).',
        args: [{ name: 'text', type: 'string', required: true, greedy: true }],
        async run(ctx, { text }) {
          if (!(await requireBotOwner(ctx))) return;
          setMaintenance(ctx.guild.id, { message: text.slice(0, 500) });
          await ctx.reply(`✅ Maintenance notice saved:\n> ${text.slice(0, 500)}`);
        },
      },
      {
        name: 'nomessage',
        description: 'Back to the default maintenance notice.',
        args: [],
        async run(ctx) {
          if (!(await requireBotOwner(ctx))) return;
          setMaintenance(ctx.guild.id, { message: null });
          await ctx.reply(`✅ Back to the default notice:\n> ${DEFAULT_MAINTENANCE_MESSAGE}`);
        },
      },
    ],
  },
};
