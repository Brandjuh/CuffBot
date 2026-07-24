import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { isPinnedLadder, ladderForGuild } from '../../academy/service.js';
import { ladderTable } from '../lib/xp.js';
import { getUserXp, getXpConfig } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('xp-ladder')
    .setDescription('The XP list: which XP total earns which rank.'),
  async execute(interaction) {
    const ladder = ladderForGuild(interaction.guild);
    if (ladder.ranks.length === 0) {
      await interaction.reply({
        content:
          '🚫 No rank ladder detected. An admin can point me at the header role with `/rank-setup header:@[LEVELER]`, then try again.',
        flags: 64,
      });
      return;
    }

    const config = getXpConfig(interaction.guild.id);
    const rows = ladderTable(ladder, config);
    const myXp = getUserXp(interaction.guild.id, interaction.user.id);
    const fmt = (n) => n.toLocaleString('en-US');

    // Mark the tier the invoker's XP has EARNED (which promote-only sync
    // grants; a hand-given higher rank simply sits above this marker).
    let myTier = -1;
    rows.forEach((row, index) => {
      if (myXp >= row.fromXp) myTier = index;
    });
    const marker = (tier) => (myTier === tier ? ` ⬅️ you (${fmt(myXp)} XP)` : '');

    const lines = [
      `**${'0'.padStart(1)} XP** — _no rank yet_${marker(-1)}`,
      ...rows.map((row, index) => `**${fmt(row.fromXp)} XP** — <@&${row.roleId}>${marker(index)}`),
    ];
    const pinNote = isPinnedLadder(interaction.guild.id, ladder)
      ? ''
      : '\n\n⚠️ Ladder not pinned — auto-promotions stay idle until an admin runs `/rank-setup`.';

    const embed = new EmbedBuilder()
      .setColor(0xd4a24e)
      .setTitle('📈 XP Ladder — what earns what')
      .setDescription(`${lines.join('\n')}${pinNote}`.slice(0, 4_000))
      .setFooter({
        text: `XP: ${config.messageXp}/message (max 1 per ${Math.round(config.messageCooldownMs / 1000)} s) + ${config.voiceXpPerMin}/voice minute. Ranks are promote-only.`,
      });
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
