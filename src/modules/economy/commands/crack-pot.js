// The daily pot attempt as its own command (S63 owner request — replaces the
// clunky `/pot try:True`). Outcomes are short, clean embeds: the win is loud,
// the loss is one line, refusals are ephemeral.
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { tryPot } from '../service.js';

const gold = (n) => `${n.toLocaleString('en-US')} 🍩`;

export default {
  data: new SlashCommandBuilder()
    .setName('crack-pot')
    .setDescription('Take your one daily shot at cracking the donut pot open (0.5% — winner takes all).'),
  async execute(interaction) {
    const who = interaction.member?.displayName ?? interaction.user.username;
    const result = tryPot(interaction.guild.id, interaction.user.id);

    if (result.code === 'disabled') {
      await interaction.reply({ content: '🍩 The economy is currently disabled.', flags: 64 });
      return;
    }
    if (result.code === 'already') {
      await interaction.reply({
        content: '🍯 You already took today’s shot — new chance after midnight UTC.',
        flags: 64,
      });
      return;
    }

    const embed =
      result.code === 'win'
        ? new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('💥 JACKPOT!')
            .setDescription(`**${who}** cracked the pot wide open!\n# +${gold(result.amount)}\nThe pot starts over at zero.`)
        : new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('🍯 The pot doesn’t budge')
            .setDescription(`**${who}** rattles it… nothing. **${gold(result.balance)}** stays locked. Tomorrow is a new day.`);
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
