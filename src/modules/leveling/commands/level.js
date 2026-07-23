import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { ladderForGuild } from '../../academy/service.js';
import { currentRank } from '../../academy/lib/ladder.js';
import { levelProgress, targetRank } from '../lib/xp.js';
import { ensureSeeded, getXpConfig } from '../service.js';

/** A 12-slot progress bar for the embed. */
export function progressBar(into, span, slots = 12) {
  if (!span || span <= 0) return '▰'.repeat(slots);
  const filled = Math.max(0, Math.min(slots, Math.round((into / span) * slots)));
  return '▰'.repeat(filled) + '▱'.repeat(slots - filled);
}

export default {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Show a member’s XP, rank, and progress to the next rank.')
    .addUserOption((option) =>
      option.setName('target').setDescription('Whose level to show (default: you)'),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('target') ?? interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: `🚫 ${target} is not in the precinct.`, flags: 64 });
      return;
    }

    const config = getXpConfig(interaction.guild.id);
    const ladder = ladderForGuild(interaction.guild);
    // First sight of an existing member seeds their XP from the rank they hold.
    const record = ensureSeeded(interaction.guild.id, member, ladder, config);
    const xp = record.xp;

    const progress = levelProgress(xp, ladder.ranks.length, config);
    const heldRank = currentRank([...member.roles.cache.keys()], ladder);
    const earnedRank = targetRank(xp, ladder, config);

    const embed = new EmbedBuilder()
      .setColor(0x2e86de)
      .setTitle(`🎖️ Service Record — ${member.displayName}`)
      .setThumbnail(target.displayAvatarURL?.() ?? null);

    const lines = [`**XP:** ${xp.toLocaleString('en-US')}`];
    lines.push(`**Rank:** ${heldRank ? `<@&${heldRank.roleId}>` : '_none yet — keep patrolling_'}`);
    if (ladder.ranks.length === 0) {
      lines.push('_No rank ladder configured — an admin can run `/rank-setup`._');
    } else if (progress.nextThreshold === null) {
      lines.push('**Next:** top of the ladder — nowhere left to climb. 🫡');
    } else {
      const span = progress.nextThreshold - progress.currentFloor;
      const next = ladder.ranks[ladder.ranks.length - progress.achieved - 1];
      lines.push(
        `**Next:** <@&${next.roleId}> at ${progress.nextThreshold.toLocaleString('en-US')} XP ` +
          `(${progress.xpForNext.toLocaleString('en-US')} to go)`,
      );
      lines.push(`\`${progressBar(progress.xpIntoRank, span)}\``);
    }
    // Surface a rank the XP has earned but the member doesn't hold yet (e.g.
    // role sync off or blocked) so the state is explainable, not mysterious.
    if (earnedRank && earnedRank.roleId !== heldRank?.roleId && config.syncRoles === false) {
      lines.push(`_XP has earned <@&${earnedRank.roleId}>, but automatic rank sync is off._`);
    }
    if (record.seededFromRank) {
      embed.setFooter({ text: `XP seeded from existing rank: ${record.seededFromRank}` });
    }

    embed.setDescription(lines.join('\n'));
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
