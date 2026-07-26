// The heist panels' component pump (S126 = M26.4a).
//
// A second listener beside `events/buttons.js`, on the `hp:` prefix rather
// than the crew lobby's `hst:`. They are kept apart deliberately: the lobby is
// a SHARED message with several legitimate pressers, and these four are
// personal boards with exactly one owner. Folding them together would mean one
// handler carrying two different answers to "may you press this?".
import { Events, MessageFlags } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { PAYLOADS, decodeId } from '../panel-runtime.js';
import { buyItem, craftItem, equipItem, getPlayer, unequipSlot } from '../service.js';
import { fmt } from '../lib/tables.js';
import { startHeistFromPanel } from '../commands/heist.js';

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

const money = (n) => Number(n).toLocaleString('en-US');

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const state = decodeId(interaction.customId ?? '');
    if (!state) return;

    try {
      // These are personal boards — your level, your wallet, your locker — so
      // a stranger gets a pointer to their own rather than silence (S98).
      if (interaction.user.id !== state.owner) {
        await quiet(interaction, `💰 That is <@${state.owner}>'s board. Run \`!heist\` for your own.`);
        return;
      }

      const guildId = interaction.guild.id;
      const userId = interaction.user.id;
      const refresh = async (next = {}) =>
        interaction.update(await PAYLOADS[state.view](guildId, userId, { ...state, ...next })).catch(() => {});

      // ── paging, shared by every view ─────────────────────────────────────
      if (state.action === 'prev' || state.action === 'next') {
        await refresh({ page: state.page + (state.action === 'next' ? 1 : -1) });
        return;
      }
      if (state.action === 'page') return; // the counter is disabled; a press cannot reach here

      // ── the job board ────────────────────────────────────────────────────
      if (state.action === 'job') {
        await startHeistFromPanel(interaction, interaction.values?.[0]);
        return;
      }

      // ── the shop ─────────────────────────────────────────────────────────
      if (state.action === 'buy') {
        const itemId = interaction.values?.[0];
        const result = await buyItem(guildId, userId, itemId, 1);
        if (result.error) {
          await quiet(
            interaction,
            result.error === 'too-poor'
              ? `💰 That costs **${money(result.cost)} 🍩** and you have **${money(result.balance)}**.`
              : '💰 Nothing by that name on the shelf.',
          );
          return;
        }
        // Refresh first so the wallet line is current, then hand over the
        // receipt — a receipt under a stale balance reads like it failed.
        await refresh();
        await interaction
          .followUp({ content: `✅ Bought **${fmt(itemId)}**.`, flags: MessageFlags.Ephemeral })
          .catch(() => {});
        return;
      }

      // ── the equipment rack ───────────────────────────────────────────────
      if (state.action.startsWith('equip:')) {
        const result = equipItem(guildId, userId, interaction.values?.[0]);
        if (result.error) {
          await quiet(interaction, result.error === 'not-owned' ? '⚙️ That is not in your locker.' : '⚙️ You cannot equip that.');
          return;
        }
        await refresh();
        return;
      }
      if (state.action.startsWith('unequip:')) {
        const slot = state.action.slice('unequip:'.length);
        const result = unequipSlot(guildId, userId, slot);
        if (result.error) {
          await quiet(interaction, '⚙️ Nothing in that slot.');
          return;
        }
        await refresh();
        return;
      }

      // ── the crafting bench ───────────────────────────────────────────────
      if (state.action === 'recipe') {
        await refresh({ selected: interaction.values?.[0] });
        return;
      }
      if (state.action === 'craft:make') {
        if (!state.selected) {
          await quiet(interaction, '🔨 Pick a recipe first.');
          return;
        }
        const result = craftItem(guildId, userId, state.selected);
        if (result.error) {
          await quiet(
            interaction,
            result.error === 'missing-materials'
              ? `🔨 Not enough materials for **${fmt(state.selected)}**.`
              : '🔨 That is not a recipe.',
          );
          return;
        }
        await refresh();
        await interaction
          .followUp({ content: `🔨 Crafted **${fmt(state.selected)}**.`, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    } catch (error) {
      logger.warn('Heist panel interaction failed:', error);
    }
  },
};

/** Exported for the tests: the player record a panel reads. */
export const panelPlayer = getPlayer;
