// The crime panel's component pump (M26.3a).
//
// The panel is a PERSONAL board — your wallet, your cooldowns, your cell — so
// unlike a Connect 4 table it has exactly one owner. A stranger's press is
// answered privately with the command that gets them their own, rather than
// silently doing nothing (S98's non-originator rule; handing them their own
// panel would recurse, since that copy would need its own buttons).
import { Events, MessageFlags } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { bailOutOutcome } from '../lib/panel.js';
import { attemptFromPanel, panelPayload } from '../commands/crime.js';
import { getAttempt } from '../attempts.js';
import {
  attemptJailbreak,
  cityAdjustBalance,
  cityBalance,
  getCriminal,
  jailState,
  payCityBail,
  updateCriminal,
} from '../service.js';
import { CRIMES } from '../lib/tables.js';

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const raw = interaction.customId ?? '';
    if (!raw.startsWith('cty:')) return;
    const [, action, ...rest] = raw.split(':');

    try {
      // The owner rides in the custom id, so a press is attributable without
      // keeping panel state in memory across a restart.
      const ownerId = rest.at(-1);
      if (interaction.user.id !== ownerId) {
        await quiet(interaction, `🌃 That is <@${ownerId}>'s board. Run \`!crime\` for your own.`);
        return;
      }

      if (action === 'refresh') {
        await interaction.update(await panelPayload(interaction.guild, interaction.user)).catch(() => {});
        return;
      }

      if (action === 'pick') {
        const crimeType = interaction.values?.[0];
        if (!crimeType || !CRIMES[crimeType]) {
          await quiet(interaction, '🌃 That job is no longer on the board.');
          return;
        }
        await attemptFromPanel(interaction, crimeType);
        return;
      }

      if (action === 'bail-out') {
        const crimeType = rest[0];
        const live = getAttempt(interaction.message?.id);
        if (!live || live.settled) {
          await quiet(interaction, '🏃 Too late — that job already played out.');
          return;
        }
        const balance = await cityBalance(interaction.guild.id, interaction.user.id);
        const verdict = bailOutOutcome(balance);
        if (!verdict.ok) {
          await quiet(interaction, `🏃 Bailing out costs **${verdict.cost} 🍩**; you have **${balance}**.`);
          return;
        }
        live.bailed = true;
        live.settled = true;
        await cityAdjustBalance(interaction.guild.id, interaction.user.id, -verdict.cost);
        // The cooldown still burns. Skipping it would make Bail Out a free
        // re-roll rather than a decision with a price.
        updateCriminal(interaction.guild.id, interaction.user.id, (c) => {
          c.cooldowns = { ...c.cooldowns, [crimeType]: Date.now() };
          return c;
        });
        await interaction
          .update({
            embeds: [
              {
                title: '🏃 Bailed out',
                description: `<@${interaction.user.id}> thought better of the ${crimeType.replace(/_/g, ' ')}.\n**Cost:** ${verdict.cost} 🍩 · the cooldown still runs.`,
                color: 0xf1c40f,
              },
            ],
            components: [],
          })
          .catch(() => {});
        return;
      }

      if (action === 'bail' || action === 'jailbreak') {
        if (!jailState(getCriminal(interaction.guild.id, interaction.user.id)).jailed) {
          await quiet(interaction, '🌃 You are not in a cell.');
          return;
        }
        const result =
          action === 'bail'
            ? await payCityBail(interaction.guild.id, interaction.user.id)
            : await attemptJailbreak(interaction.guild.id, interaction.user.id);
        await quiet(interaction, result.message ?? (result.ok ? '✅ Done.' : '🚫 That did not work.'));
        await interaction.message?.edit?.(await panelPayload(interaction.guild, interaction.user)).catch(() => {});
      }
    } catch (error) {
      logger.warn('City panel interaction failed:', error);
    }
  },
};
