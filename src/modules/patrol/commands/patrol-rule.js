// S95 (M17.3 slice C): converted to the flat { command } shape. The
// unknown-rule branch is gone — `choices` refuses it before run() is entered,
// naming the valid rules.
import { PermissionFlagsBits } from 'discord.js';
import { getPatrolConfig, setPatrolConfig } from '../service.js';

const RULES = { bannedTerms: 'Banned terms', invites: 'Invite links', spam: 'Spam' };

export default {
  command: {
    name: 'patrol-rule',
    description: 'Switch a patrol rule category on or off.',
    emoji: '👮',
    permission: PermissionFlagsBits.ManageGuild,
    args: [
      { name: 'rule', type: 'string', required: true, choices: Object.keys(RULES) },
      { name: 'state', type: 'string', required: true, choices: ['on', 'off'] },
    ],
    async run(ctx, { rule, state }) {
      const config = getPatrolConfig(ctx.guild.id);
      config.rules[rule] = state === 'on';
      setPatrolConfig(ctx.guild.id, config);
      await ctx.reply(`👮 ${RULES[rule]} screening switched **${state}**.`);
    },
  },
};
