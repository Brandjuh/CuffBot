import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  clearEvidenceLocker,
  getEvidenceLocker,
  setEvidenceLocker,
} from '../lib/api.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';

// No channel option: "set" uses the channel the command is run in. This keeps
// the command working identically as a text command (the prefix adapter does
// not resolve channel mentions) and matches the common "run this in the log
// channel" convention.
export default {
  data: new SlashCommandBuilder()
    .setName('evidence-locker')
    .setDescription('Configure the evidence locker — the channel that logs enforcement actions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('set (use this channel), status, or clear (default: status)')
        .addChoices(
          { name: 'status', value: 'status' },
          { name: 'set (this channel)', value: 'set' },
          { name: 'clear', value: 'clear' },
        ),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const action = interaction.options.getString('action') ?? 'status';
    const guildId = interaction.guild.id;

    if (action === 'set') {
      setEvidenceLocker(guildId, interaction.channel.id);
      await interaction.reply({
        content: `🗄️ Evidence locker set to ${interaction.channel}. Enforcement actions will be logged here.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (action === 'clear') {
      clearEvidenceLocker(guildId);
      await interaction.reply({
        content: '🗄️ Evidence locker cleared. Enforcement actions will no longer be logged to a channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const current = getEvidenceLocker(guildId);
    await interaction.reply({
      content: current
        ? `🗄️ Evidence locker is <#${current}>. Run \`/evidence-locker action:clear\` to disable, or \`action:set\` in another channel to move it.`
        : '🗄️ No evidence locker configured. Run `/evidence-locker action:set` in the channel you want enforcement actions logged to.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
