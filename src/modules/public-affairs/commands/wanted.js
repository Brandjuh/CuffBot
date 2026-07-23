import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { pickBounty, pickCrime, wantedEmbed } from '../lib/cards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('wanted')
    .setDescription('Put up a playful WANTED poster for a member (just for fun).')
    .addUserOption((option) =>
      option.setName('target').setDescription('Who is wanted').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('crime').setDescription('Their alleged crime (default: a random one)').setMaxLength(150),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('target', true);
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const crime = interaction.options.getString('crime') ?? pickCrime(target.id);
    const data = wantedEmbed({
      displayName: member?.displayName ?? target.username,
      crime,
      bounty: pickBounty(target.id),
      avatarURL: target.displayAvatarURL?.() ?? null,
    });
    await interaction.reply({ content: `${target}`, embeds: [EmbedBuilder.from(data)] });
  },
};
