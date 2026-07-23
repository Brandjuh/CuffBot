import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { badgeEmbed } from '../lib/cards.js';
import { resolveLadder } from '../../academy/service.js';
import { currentRank } from '../../academy/lib/ladder.js';
import { recordsFor } from '../../records/lib/api.js';
import { logger } from '../../../core/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('badge')
    .setDescription('Show a member’s badge: rank, record count, and time on the force.')
    .addUserOption((option) =>
      option.setName('target').setDescription('Whose badge to show (default: you)'),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('target') ?? interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    // Rank and record are best-effort — a missing/broken module must not break /badge.
    let rankName = null;
    try {
      if (member) {
        const ladder = resolveLadder(interaction);
        rankName = currentRank([...member.roles.cache.keys()], ladder)?.name ?? null;
      }
    } catch (error) {
      logger.warn('Badge: rank lookup failed:', error);
    }
    let recordCount = 0;
    try {
      recordCount = recordsFor(interaction.guild.id, target.id).length;
    } catch (error) {
      logger.warn('Badge: record lookup failed:', error);
    }

    const data = badgeEmbed({
      displayName: member?.displayName ?? target.username,
      joinedTimestamp: member?.joinedTimestamp ?? null,
      rankName,
      recordCount,
      avatarURL: target.displayAvatarURL?.() ?? null,
    });
    await interaction.reply({ embeds: [EmbedBuilder.from(data)] });
  },
};
