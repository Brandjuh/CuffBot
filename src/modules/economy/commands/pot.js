// The pot VIEW (S63 owner request: the old text wall read as clutter, and
// `/pot try:True` was clunky). Viewing and cracking are now two commands:
// /pot shows the state, /crack-pot takes the daily shot.
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getPot, hasPotTryToday } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pot')
    .setDescription('The donut pot: how much is in it, and whether your daily crack attempt is still open.'),
  async execute(interaction) {
    const guildId = interaction.guild.id;
    const pot = getPot(guildId);
    const tried = hasPotTryToday(guildId, interaction.user.id);
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🍯 The Donut Pot')
      .setDescription(
        [
          `# ${pot.balance.toLocaleString('en-US')} 🍩`,
          '',
          '**How it fills** — busted `/steal` attempts, escaped crooks, and **+500** 🍩 every day.',
          `**Your daily shot** — ${tried ? '❌ used for today (new chance after midnight UTC)' : '✅ still open: `/crack-pot`'}`,
          '**The odds** — 0.5%. Winner takes the whole pot.',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
