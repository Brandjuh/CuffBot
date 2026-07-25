// /steal (S40, cooldown S48, pot S41). S63 owner request: outcomes are now
// short, clean embeds instead of run-on text — one bold fact per line.
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { formatWaitMs } from '../lib/bank.js';
import { attemptHeist, getEconomyConfig } from '../service.js';

const gold = (n) => `${n.toLocaleString('en-US')} 🍩`;

export default {
  data: new SlashCommandBuilder()
    .setName('steal')
    .setDescription('Attempt to steal donuts from another officer (30% odds — get busted and you pay the pot).')
    .addUserOption((o) =>
      o.setName('target').setDescription('Whose donuts you are after').setRequired(true),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('target', true);
    if (target.bot) {
      await interaction.reply({ content: '🤖 Bots keep their donuts in the cloud — unstealable.', flags: 64 });
      return;
    }

    const config = getEconomyConfig(interaction.guild.id);
    const result = attemptHeist(interaction.guild, interaction.user.id, target.id);
    const thief = interaction.member?.displayName ?? interaction.user.username;
    const victim = target.username;

    switch (result.code) {
      case 'disabled':
        await interaction.reply({ content: '🍩 The economy is currently disabled.', flags: 64 });
        return;
      case 'self':
        await interaction.reply({
          content: '🪞 Stealing from yourself is just moving donuts between pockets.',
          flags: 64,
        });
        return;
      case 'cooldown':
        await interaction.reply({
          content: `🕶️ Lay low — the heat is still on. Next attempt in ~${formatWaitMs(result.waitMs)}.`,
          flags: 64,
        });
        return;
      case 'success': {
        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('🕶️ HEIST!')
          .setDescription(
            result.amount > 0
              ? [
                  `**${thief}** slipped past **${victim}**.`,
                  `# +${gold(result.amount)}`,
                  ...(result.amount < config.heistAmount ? ['_That was everything they carried._'] : []),
                ].join('\n')
              : `**${thief}** picked **${victim}**’s pocket flawlessly… and found it empty.`,
          );
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        return;
      }
      case 'failure':
      default: {
        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('🚨 BUSTED!')
          .setDescription(
            result.amount > 0
              ? [
                  `**${thief}** got caught robbing **${victim}**.`,
                  `# −${gold(result.amount)}`,
                  `_Confiscated into the donut pot — now **${gold(result.potBalance)}**. Your shot: \`/crack-pot\`._`,
                ].join('\n')
              : `**${thief}** got caught robbing **${victim}** — with already-empty pockets. The pot sighs.`,
          );
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      }
    }
  },
};
