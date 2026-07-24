import { SlashCommandBuilder } from 'discord.js';
import { attemptHeist, getEconomyConfig } from '../service.js';

const noPing = { allowedMentions: { parse: [] } };
const donuts = (n) => `**${n.toLocaleString('en-US')} donuts** 🍩`;

export default {
  data: new SlashCommandBuilder()
    .setName('steal')
    .setDescription('Attempt to steal donuts from another officer (30% odds — get caught and the chief collects).')
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
          content: '🪞 Stealing from yourself? That’s just moving donuts between pockets.',
          flags: 64,
        });
        return;
      case 'cooldown': {
        const minutes = Math.ceil(result.waitMs / 60_000);
        await interaction.reply({
          content: `🕶️ Lay low — the heat is still on. Try again in ~${minutes} min.`,
          flags: 64,
        });
        return;
      }
      case 'success': {
        const line =
          result.amount > 0
            ? `🕶️ **HEIST!** ${thief} slipped past ${victim} and lifted ${donuts(result.amount)}${
                result.amount < config.heistAmount ? ' — that was everything they had on them' : ''
              }!`
            : `🕶️ ${thief} picked ${victim}’s pocket flawlessly… and found it completely empty.`;
        await interaction.reply({ content: line, ...noPing });
        return;
      }
      case 'failure':
      default: {
        const line =
          result.amount > 0
            ? `🚨 **BUSTED!** ${thief} got caught red-handed robbing ${victim} — ${donuts(result.amount)} confiscated into the **donut pot** 🍯 (now holding ${donuts(result.potBalance)}; crack it with \`/pot\`).`
            : `🚨 **BUSTED!** ${thief} got caught robbing ${victim}, but their own pockets were already empty. The pot sighs.`;
        await interaction.reply({ content: line, ...noPing });
      }
    }
  },
};
