// The heist panels' component pump (S126 = M26.4a).
//
// A second listener beside `events/buttons.js`, on the `hp:` prefix rather
// than the crew lobby's `hst:`. They are kept apart deliberately: the lobby is
// a SHARED message with several legitimate pressers, and these four are
// personal boards with exactly one owner. Folding them together would mean one
// handler carrying two different answers to "may you press this?".
import { Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { ADMIN_VIEWS, PAYLOADS, decodeId, valueModal } from '../panel-runtime.js';
import {
  buyItem,
  craftItem,
  equipItem,
  getPlayer,
  resetHeistOverrides,
  setHeistOverride,
  setItemPrice,
  startHeistEvent,
  stopHeistEvent,
  unequipSlot,
} from '../service.js';
import { fmt } from '../lib/tables.js';
import { packSelection, unpackSelection } from '../lib/panels.js';
import { startHeistFromPanel } from '../commands/heist.js';

/** The event panel's Start button uses the cog's own defaults. */
export const EVENT_MULTIPLIER = 2;
export const EVENT_HOURS = 24;

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

const money = (n) => Number(n).toLocaleString('en-US');

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const state = decodeId(interaction.customId ?? '');
    if (!state) return;

    try {
      // The three admin views change the game for EVERYONE, so ownership of
      // the message is not enough — the presser must still hold the
      // permission. Checked before the owner check so a non-admin who somehow
      // owns the panel is refused for the right reason.
      if (ADMIN_VIEWS.has(state.view)) {
        const perms = interaction.channel?.permissionsFor?.(interaction.member) ?? interaction.member?.permissions;
        if (!perms?.has?.(PermissionFlagsBits.ManageGuild)) {
          await quiet(interaction, '🚫 Tuning the heist needs **Manage Server**.');
          return;
        }
      }
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
      // ── the admin panels (S130) ──────────────────────────────────────────
      if (state.action === 'cfg-job') {
        // Choosing a different job clears the field: the fields are per-job in
        // meaning even where they share a name, and carrying a selection
        // across would let a press edit something the admin never looked at.
        await refresh({ selected: packSelection(interaction.values?.[0], null) });
        return;
      }
      if (state.action === 'cfg-field') {
        const { job } = unpackSelection(state.selected);
        await refresh({ selected: packSelection(job, interaction.values?.[0]) });
        return;
      }
      if (state.action === 'price-pick') {
        await refresh({ selected: interaction.values?.[0] });
        return;
      }

      if (state.action === 'cfg-set' || state.action === 'price-set') {
        await interaction.showModal(valueModal(state)).catch(() => {});
        return;
      }

      if (state.action === 'value-modal') {
        const raw = interaction.fields?.getTextInputValue?.('value') ?? '';
        if (state.view === 'prices') {
          const result = setItemPrice(guildId, state.selected, Number.parseInt(raw, 10));
          if (!result.ok) {
            await quiet(
              interaction,
              result.error === 'out-of-range'
                ? '💰 A price has to be a whole number between 0 and 10,000,000.'
                : '💰 That item is not for sale, so it has no price to set.',
            );
            return;
          }
          await interaction.update(await PAYLOADS.prices(guildId, userId, state)).catch(() => {});
          return;
        }
        const { job, field } = unpackSelection(state.selected);
        const result = setHeistOverride(guildId, job, field, raw);
        if (!result.ok) {
          await quiet(
            interaction,
            result.error === 'out-of-range'
              ? `⚙️ That has to be between **${result.min}** and **${result.max}**.`
              : result.error === 'not-a-number'
                ? '⚙️ That is not a number.'
                : '⚙️ Unknown job or field.',
          );
          return;
        }
        await interaction.update(configPayloadFor(guildId, userId, state)).catch(() => {});
        return;
      }

      if (state.action === 'cfg-reset') {
        const { job } = unpackSelection(state.selected);
        resetHeistOverrides(guildId, job);
        await refresh();
        await interaction
          .followUp({ content: `↩️ **${fmt(job)}** is back to its shipped values.`, flags: MessageFlags.Ephemeral })
          .catch(() => {});
        return;
      }

      if (state.action === 'event-start') {
        startHeistEvent(guildId, EVENT_MULTIPLIER, EVENT_HOURS);
        await refresh();
        return;
      }
      if (state.action === 'event-stop') {
        stopHeistEvent(guildId);
        await refresh();
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

/** A modal submit cannot `refresh()` through the shared helper (its state has
 *  no page), so the config view gets its payload directly. */
function configPayloadFor(guildId, userId, state) {
  return PAYLOADS.config(guildId, userId, state);
}
