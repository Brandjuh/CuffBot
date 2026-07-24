import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { RUNTIME_ADMIN_COMMANDS, buildCategorizedHelp, paginateHelp } from '../../../core/help.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the commands YOU can use, sorted by category (only you see the reply).'),
  async execute(interaction) {
    const prefix = interaction.client.config?.prefix ?? '!';
    const commands = (interaction.client.moduleList ?? []).flatMap((mod) =>
      mod.commands.map((cmd) => {
        const json = cmd.data.toJSON();
        return {
          name: json.name,
          description: json.description,
          defaultMemberPermissions: json.default_member_permissions ?? null,
        };
      }),
    );

    // Only show what this viewer can actually run (S43): commands declaring
    // default permissions the member lacks are hidden, as are the two
    // runtime-gated admin commands.
    const perms = interaction.memberPermissions;
    const isAdmin = perms?.has?.(PermissionFlagsBits.ManageGuild) ?? false;
    const isVisible = (cmd) => {
      if (RUNTIME_ADMIN_COMMANDS.has(cmd.name)) return isAdmin;
      if (!cmd.defaultMemberPermissions) return true;
      try {
        return perms?.has?.(BigInt(cmd.defaultMemberPermissions)) ?? false;
      } catch {
        return true; // an unparsable bitfield must never hide the whole menu
      }
    };

    // Ephemeral pages (S39): the roster exceeds one embed's 6000-char total.
    const pages = paginateHelp(buildCategorizedHelp(commands, prefix, { isVisible }));
    for (const [index, page] of pages.entries()) {
      const embed = new EmbedBuilder().setColor(0x8a5a6a).setTitle(page.title).addFields(page.fields);
      if (page.description) embed.setDescription(page.description);
      const payload = { embeds: [embed], flags: 64 };
      if (index === 0) await interaction.reply(payload);
      else await interaction.followUp(payload);
    }
  },
};
