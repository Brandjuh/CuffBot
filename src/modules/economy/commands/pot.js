import { SlashCommandBuilder } from 'discord.js';
import { getPot, tryPot } from '../service.js';

const donuts = (n) => `**${n.toLocaleString('en-US')} donuts** 🍩`;
const noPing = { allowedMentions: { parse: [] } };

export default {
  data: new SlashCommandBuilder()
    .setName('pot')
    .setDescription('The donut pot: every lost donut lands here (+500/day). One crack attempt per day, 0.5%.')
    .addBooleanOption((o) =>
      o.setName('try').setDescription('Take your daily shot at cracking the pot open'),
    ),
  async execute(interaction) {
    const guildId = interaction.guild.id;
    const who = interaction.member?.displayName ?? interaction.user.username;

    if (interaction.options.getBoolean('try') !== true) {
      const pot = getPot(guildId);
      await interaction.reply({
        content:
          `🍯 **The donut pot holds ${donuts(pot.balance)}.**\n` +
          'It collects every lost donut (busted `/steal`s, escaped crooks) and grows **+500** 🍩 every day. ' +
          'Once a day you may try to crack it — **0.5%** odds, winner takes ALL: `/pot try:True` (resets at midnight UTC).',
        flags: 64,
        textInChannel: true,
      });
      return;
    }

    const result = tryPot(guildId, interaction.user.id);
    switch (result.code) {
      case 'disabled':
        await interaction.reply({ content: '🍩 The economy is currently disabled.', flags: 64, textInChannel: true });
        return;
      case 'already':
        await interaction.reply({
          content: '🍯 You already rattled the pot today — new chance after midnight UTC.',
          flags: 64,
          textInChannel: true,
        });
        return;
      case 'win':
        await interaction.reply({
          content: `💥🍯 **JACKPOT!!** ${who} cracked the donut pot wide open and walks away with ${donuts(result.amount)}! The pot starts over at zero.`,
          ...noPing,
        });
        return;
      case 'lose':
      default:
        await interaction.reply({
          content: `🍯 ${who} rattled the pot… it didn’t budge. It keeps its ${donuts(result.balance)}. Better luck tomorrow!`,
          ...noPing,
        });
    }
  },
};
