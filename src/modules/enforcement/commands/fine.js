// The public, for-fun sibling of /cite: anyone can issue a joke citation. It
// changes NOTHING — no permissions, no records, no moderation action — it just
// prints the same animated ticket for laughs. Kept next to /cite so both share
// the one citation renderer.
import { AttachmentBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { renderCitationGif } from '../lib/citation-card.js';

export default {
  data: new SlashCommandBuilder()
    .setName('fine')
    .setDescription('Issue a playful citation to anyone — just for laughs, no real consequences.')
    .addUserOption((option) =>
      option.setName('target').setDescription('Who gets the joke ticket').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('The (silly) violation')
        .setRequired(true)
        .setMaxLength(200),
    )
    .addStringOption((option) =>
      option
        .setName('penalty')
        .setDescription('Penalty text (default: PAY UP IN DONUTS)')
        .setMaxLength(100),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('target', true);
    if (target.id === interaction.client.user.id) {
      await interaction.reply({
        content: '🍩 Nice try — you cannot fine the police.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = interaction.options.getString('reason', true);
    const penalty = interaction.options.getString('penalty') ?? 'PAY UP IN DONUTS';
    const { gif } = renderCitationGif({
      to: target.displayName ?? target.username,
      reason,
      penalty,
      officer: interaction.user.displayName ?? interaction.user.username,
      date: new Date().toISOString().slice(0, 10),
      badgeSeed: target.id,
    });

    await interaction.reply({
      content: `🎟️ ${interaction.user} slapped ${target} with a citation — all in good fun. Reason: ${reason}`,
      files: [new AttachmentBuilder(gif, { name: 'citation.gif' })],
    });
  },
};
