import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { buildHelp } from '../../../core/help.js';

const FIELD_LIMIT = 1024; // Discord embed field value cap.

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show every CuffBot command and how to use it.'),
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

    const model = buildHelp(modules, prefix);
    const embed = new EmbedBuilder()
      .setColor(0x8a5a6a)
      .setTitle(model.title)
      .setDescription(model.description);

    for (const group of model.groups) {
      let value = group.entries
        .map((e) => `${e.invocations} — ${e.description}\n usage: ${e.usage}`)
        .join('\n');
      if (value.length > FIELD_LIMIT) value = `${value.slice(0, FIELD_LIMIT - 2)}…`;
      embed.addFields({ name: group.title, value });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
