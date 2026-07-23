import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { renderCitation } from '../lib/citation-card.js';
import { ensureInvokerPermission, ensureSensibleTarget } from '../guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('cite')
    .setDescription('Issue a formal citation (warning) — delivered as a Papers-Please-style ticket.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName('target').setDescription('Who receives the citation').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('The violation being cited')
        .setRequired(true)
        .setMaxLength(200),
    )
    .addStringOption((option) =>
      option
        .setName('penalty')
        .setDescription('Penalty text on the ticket (default: OFFICIAL WARNING)')
        .setMaxLength(100),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members'))) return;
    const target = interaction.options.getUser('target', true);
    if (!(await ensureSensibleTarget(interaction, target))) return;

    const reason = interaction.options.getString('reason', true);
    const penalty = interaction.options.getString('penalty') ?? undefined;

    const { png } = renderCitation({
      to: target.displayName ?? target.username,
      reason,
      penalty,
      officer: interaction.user.displayName ?? interaction.user.username,
      date: new Date().toISOString().slice(0, 10),
      badgeSeed: target.id,
    });

    await interaction.reply({
      content: `📋 Citation issued to ${target}. Reason: ${reason}`,
      files: [new AttachmentBuilder(png, { name: 'citation.png' })],
    });

    // Best-effort DM copy — closed DMs are common and not an error.
    const dmDelivered = await target
      .send({
        content: `📋 You received a citation in **${interaction.guild.name}**.`,
        files: [new AttachmentBuilder(png, { name: 'citation.png' })],
      })
      .then(() => true)
      .catch(() => false);
    if (!dmDelivered) {
      await interaction.followUp({
        content: '(No DM copy delivered — their DMs are closed.)',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};
