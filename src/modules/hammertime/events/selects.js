// Hammertime timezone-picker pump (S84): the "htz:" select rows opened by
// `!ht tz` / `!ht role` when a query matches several zones. Only the officer
// who asked may pick (cog interaction_check).
import { Events, MessageFlags } from 'discord.js';
import { applyZoneChoice } from '../commands/hammertime.js';
import { clearPendingPick, getPendingPick } from '../service.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isStringSelectMenu?.()) return;
    const match = /^htz:pick:(\d+):\d+$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, ownerId] = match;

    if (interaction.user.id !== ownerId) {
      await interaction
        .reply({ content: 'You are not allowed to use this interaction.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }
    const pick = getPendingPick(ownerId);
    if (!pick) {
      await interaction
        .reply({ content: '⌛ That picker expired — run the command again.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }
    clearPendingPick(ownerId);
    const reply = await applyZoneChoice(pick, ownerId, interaction.values[0]);
    await interaction.update({ content: reply, components: [] }).catch(() => {});
  },
};
