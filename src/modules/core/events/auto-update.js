// The 15-minute automatic update check (S127, owner: "Ik wil dat je
// automatisch elke 15 minuten op updates controleert en deze uitvoert").
//
// ⚠️ This used to be a systemd TIMER running a second systemd SERVICE. It is
// an interval inside the bot now, and that is the substantive change, not a
// stylistic one:
//
//   * a timer the bot cannot see is a timer the bot cannot report on — for
//     five sessions the owner's only evidence that it was broken was the
//     version number not moving;
//   * every failure of the old chain (S7, S76, S78, S120) was a missing unit
//     or an unmatched sudoers line, and an interval has neither;
//   * and `bash scripts/setup-pi.sh` was required to arm it, so a Pi that
//     never ran that step silently never updated. This arms itself on boot.
//
// The announcement into the owner's channel is NOT posted from here. A
// successful update exits the process, so nothing sent at this point would
// survive; `events/update-announce.js` already posts it at boot, which is the
// moment the news is actually true.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { AUTO_CHECK_MS, RESULTS } from '../updater.js';
import { autoUpdateEnabled, rememberAutoRun } from '../update-store.js';
import { performUpdate } from '../commands/update.js';

/** Give the gateway a moment to settle before the first check. */
export const FIRST_CHECK_MS = 2 * 60_000;

let armed = false;

/** Exported for the tests: one pass over every guild the bot serves. */
export async function checkOnce(client, { update = performUpdate } = {}) {
  const guilds = [...client.guilds.cache.values()];
  if (guilds.length === 0) return null;

  // CuffBot serves one guild, but the setting is per-guild like every other
  // setting, so "any guild wants it" is the honest reading of "is it on?".
  const wanting = guilds.filter((guild) => autoUpdateEnabled(guild.id));
  if (wanting.length === 0) return null;

  const outcome = await update({ client });
  if (outcome.result === 'busy') return null;

  for (const guild of wanting) rememberAutoRun(guild.id, outcome);

  const meaning = RESULTS[outcome.result];
  if (outcome.result !== 'up-to-date') {
    // Everything that is not "nothing to do" belongs in the journal, whether
    // it worked or not. A silent failure is what this whole rebuild is about.
    const how = meaning?.ok ? 'ok' : 'FAILED';
    logger.warn(`Auto-update: ${how} — ${outcome.result} (${outcome.from ?? '?'} → ${outcome.to ?? '?'})`);
  }
  return outcome;
}

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    if (armed) return; // a reconnect must not stack a second interval
    armed = true;

    const tick = async () => {
      try {
        await checkOnce(client);
      } catch (error) {
        logger.warn('Auto-update check failed:', error);
      }
    };

    setTimeout(tick, FIRST_CHECK_MS).unref?.();
    setInterval(tick, AUTO_CHECK_MS).unref?.();
    logger.info(`Auto-update armed: checking GitHub every ${AUTO_CHECK_MS / 60_000} minutes.`);
  },
};
