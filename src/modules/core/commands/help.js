import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { buildHelp, paginateHelp } from '../../../core/help.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show every CuffBot command and how to use it (only you see the reply).'),
  async execute(interaction) {
    const prefix = interaction.client.config?.prefix ?? '!';
    const modules = (interaction.client.moduleList ?? []).map((mod) => ({
      name: mod.name,
      description: mod.description,
      commands: mod.commands.map((cmd) => {
        const json = cmd.data.toJSON();
        return { name: json.name, description: json.description, options: json.options ?? [] };
      }),
    }));

    // The full roster no longer fits one embed (Discord's 6000-char TOTAL cap
    // per embed — S39: 18 modules broke exactly there). Send ephemeral pages
    // so only the asker sees them; the "!help" text path DMs them instead.
    const pages = paginateHelp(buildHelp(modules, prefix));
    for (const [index, page] of pages.entries()) {
      const embed = new EmbedBuilder().setColor(0x8a5a6a).setTitle(page.title).addFields(page.fields);
      if (page.description) embed.setDescription(page.description);
      const payload = { embeds: [embed], flags: 64 };
      if (index === 0) await interaction.reply(payload);
      else await interaction.followUp(payload);
    }
  },
};
