// The help menu's interaction pump (S98 = M19): one module-owned
// InteractionCreate handler that only touches "help:" customIds — the trivia
// and patrol-wizard pattern.
//
// A help message is PUBLIC, so anyone can press its buttons, and the roster is
// permission-filtered per viewer (S43). Those two facts decide the design:
//
//   - The person who asked gets the message UPDATED in place. It is their
//     menu; swapping the embed is what they expect.
//   - Anyone else gets their OWN filtered view, privately. Editing the shared
//     message would rewrite what the asker is reading, and showing a stranger
//     the asker's roster would leak which commands that member can use.
//   - S109: a PANEL has no asker — it belongs to the channel and is meant to
//     be pressed by everyone forever — so every press takes the private path.
//     That is the same rule, not a fourth case: the panel simply never has an
//     originator to update.
//
// A component interaction can still be ephemeral — only `!command` replies
// lost that (S54/S68) — so the private answer is genuinely private.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { helpCategory, helpOverview } from '../../../core/help.js';
import { PANEL_OWNER, buildViewerHelp, helpPayload, parseHelpButtonId } from '../lib/help-menu.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const parsed = parseHelpButtonId(interaction.customId ?? '');
    if (!parsed) return;

    try {
      const prefix = interaction.client?.config?.prefix ?? '!';
      const model = buildViewerHelp(interaction, prefix, interaction.client?.moduleList ?? []);

      const view = parsed.key === 'overview' ? helpOverview(model) : helpCategory(model, parsed.key);
      if (!view) {
        // The presser has nothing in that category — say so rather than
        // showing an empty embed. (Only reachable for a non-owner presser,
        // since the owner's own buttons are built from their own model.)
        await interaction.reply({
          content: '📻 You have no commands in that category.',
          flags: 64,
        });
        return;
      }

      const active = parsed.key === 'overview' ? null : parsed.key;
      const payload = helpPayload(view, parsed.ownerId, { active });

      if (parsed.ownerId !== PANEL_OWNER && interaction.user.id === parsed.ownerId) {
        await interaction.update(payload);
      } else {
        // Their own menu, privately — with buttons keyed to THEM, so pressing
        // on from here keeps working and never touches the original message.
        await interaction.reply({
          ...helpPayload(view, interaction.user.id, { active }),
          flags: 64,
        });
      }
    } catch (error) {
      logger.warn('Help menu: button handling failed:', error);
    }
  },
};
