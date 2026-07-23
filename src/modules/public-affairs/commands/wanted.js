import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { pickBounty, pickCrime } from '../lib/cards.js';
import { renderWantedPoster } from '../lib/poster.js';
import { fetchAvatarRgb } from '../lib/png-decode.js';

export default {
  data: new SlashCommandBuilder()
    .setName('wanted')
    .setDescription('Put up a real WANTED poster for a member — with their photo in the middle (just for fun).')
    .addUserOption((option) =>
      option.setName('target').setDescription('Who is wanted').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('crime').setDescription('Their alleged crime (default: a random one)').setMaxLength(150),
    ),
  async execute(interaction) {
    // Rendering fetches + decodes the avatar, so defer to stay within the 3s window.
    await interaction.deferReply();
    const target = interaction.options.getUser('target', true);
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const crime = interaction.options.getString('crime') ?? pickCrime(target.id);

    // Request the avatar as a static PNG so the pure decoder can read it; a
    // failed/absent avatar falls back to a NO PHOTO placeholder.
    const url = target.displayAvatarURL?.({ extension: 'png', forceStatic: true, size: 512 }) ?? null;
    const avatar = url ? await fetchAvatarRgb(url) : null;

    const { png } = renderWantedPoster({
      displayName: member?.displayName ?? target.username,
      crime,
      bounty: pickBounty(target.id),
      avatar,
    });
    await interaction.editReply({
      content: `${target}`,
      files: [new AttachmentBuilder(png, { name: 'wanted.png' })],
    });
  },
};
