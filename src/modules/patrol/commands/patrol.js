// S95 (M17.3 slice C): converted to the flat { command } shape.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getPatrolConfig, setPatrolConfig } from '../service.js';

const onOff = (b) => (b ? '🟢 on' : '🔴 off');

export default {
  command: {
    name: 'patrol',
    description: 'View or switch automated patrol (automod) on/off.',
    emoji: '👮',
    permission: PermissionFlagsBits.ManageGuild,
    args: [{ name: 'action', type: 'string', choices: ['status', 'on', 'off'] }], // default: status
    async run(ctx, { action = 'status' }) {
      const config = getPatrolConfig(ctx.guild.id);

      if (action === 'on' || action === 'off') {
        config.enabled = action === 'on';
        setPatrolConfig(ctx.guild.id, config);
      }

      const embed = new EmbedBuilder()
        .setColor(config.enabled ? 0x4caf6a : 0x9aa0a6)
        .setTitle('👮 Patrol')
        .setDescription(
          [
            `**Patrol:** ${onOff(config.enabled)}`,
            `**Banned terms:** ${onOff(config.rules.bannedTerms)} (${config.bannedTerms.length} term${config.bannedTerms.length === 1 ? '' : 's'})`,
            `**Invite links:** ${onOff(config.rules.invites)}`,
            `**Spam:** ${onOff(config.rules.spam)}`,
          ].join('\n'),
        )
        .setFooter({
          text: `Toggle rules with ${ctx.prefix}patrol-rule · manage terms with ${ctx.prefix}patrol-term · guided setup: ${ctx.prefix}patrol-wizard`,
        });

      if (!ctx.client.messageContentAvailable) {
        embed.addFields({
          name: '⚠️ Message Content intent off',
          value:
            'Patrol cannot read messages until the Message Content intent is enabled in the Developer Portal.',
        });
      }
      await ctx.reply({ embeds: [embed] });
    },
  },
};
