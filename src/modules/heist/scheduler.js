// Heist job scheduler (S87 = M16.12 slice C): the piece that makes a finished
// job announce itself instead of waiting for the player's next command.
//
// Timers live in RAM, so the durable half is the `activeHeist` record slice B
// already persists (type, endsAt, channelId): every boot re-arms from the
// store — overdue jobs fire at once, pending ones get the remainder. The lazy
// settlement path stays exactly as it was, which is what makes a missed timer
// harmless rather than a lost job.
import { logger } from '../../core/logger.js';
import { allPlayers, settleActiveHeist } from './service.js';

// commands/heist.js imports the arming helpers from here, so the renderer is
// pulled in lazily at fire time — one direction of the cycle stays dynamic.
const renderOutcome = async (outcome, displayName) => {
  const { crewOutcomeEmbed, outcomeEmbed } = await import('./commands/heist.js');
  // A crew settlement carries a per-member breakdown; a solo one does not.
  return outcome.members ? crewOutcomeEmbed(outcome) : outcomeEmbed(outcome, displayName);
};

const timers = new Map(); // `${guildId}:${userId}` → Timeout

const keyOf = (guildId, userId) => `${guildId}:${userId}`;

/** Cancel a pending timer (a re-arm or a settled job). */
export function cancelHeistTimer(guildId, userId) {
  const key = keyOf(guildId, userId);
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

/** Test seam + clean shutdown. */
export function clearAllHeistTimers() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

/** How many jobs are currently armed (diagnostics + tests). */
export const armedHeistCount = () => timers.size;

async function resolveChannel(client, channelId) {
  if (!channelId) return null;
  const cached = client.channels?.cache?.get?.(channelId);
  if (cached) return cached;
  return client.channels?.fetch?.(channelId).catch(() => null) ?? null;
}

/**
 * Settle a due job and announce it. When the channel is gone we deliberately
 * DO NOT settle: leaving the record intact means the player's next `!heist`
 * command still reports the result, instead of the outcome vanishing.
 */
export async function fireHeist(client, guildId, userId, { now = Date.now() } = {}) {
  cancelHeistTimer(guildId, userId);
  const player = allPlayers(guildId)[userId];
  const active = player?.activeHeist;
  if (!active) return null;
  // Crew jobs are settled once, by the leader — a member's own timer is a
  // no-op so four officers cannot trigger four robberies.
  if (active.crew && active.leader && active.leader !== userId) return null;

  const channel = await resolveChannel(client, active.channelId);
  if (!channel?.send) {
    logger.warn(`Heist: channel ${active.channelId} unavailable — leaving ${userId}'s job for the lazy path.`);
    return null;
  }

  const outcome = await settleActiveHeist(guildId, userId, { now });
  if (!outcome) return null;

  const member = await client.guilds?.cache
    ?.get?.(guildId)
    ?.members?.fetch?.(userId)
    .catch(() => null);
  const displayName = member?.displayName ?? 'Officer';
  const pinged = outcome.members ? outcome.members.map((result) => result.userId) : [userId];
  await channel
    .send({
      content: pinged.map((id) => `<@${id}>`).join(' '),
      embeds: [await renderOutcome(outcome, displayName)],
      // One deliberate scoped ping: the job you were on just landed.
      allowedMentions: { users: pinged },
    })
    .catch((error) => logger.warn('Heist: could not announce a result:', error?.message ?? error));
  return outcome;
}

/**
 * Arm (or re-arm) the timer for one player's active job. An already-due job
 * fires on the next tick rather than blocking the caller.
 */
export function armHeistTimer(client, guildId, userId, endsAt, { now = Date.now() } = {}) {
  cancelHeistTimer(guildId, userId);
  const delay = Math.max(0, endsAt - now);
  const timer = setTimeout(() => {
    fireHeist(client, guildId, userId).catch((error) => logger.error('Heist timer failed:', error));
  }, delay);
  timer.unref?.();
  timers.set(keyOf(guildId, userId), timer);
  return timer;
}

/**
 * Boot catch-up: walk every guild's stored players and re-arm what is still
 * running — overdue jobs settle immediately (the cog does the same on load).
 * @returns {Promise<{armed:number, fired:number}>}
 */
export async function rearmAllHeists(client, { now = Date.now() } = {}) {
  let armed = 0;
  let fired = 0;
  const guildIds = [...(client.guilds?.cache?.keys?.() ?? [])];
  for (const guildId of guildIds) {
    for (const [userId, player] of Object.entries(allPlayers(guildId))) {
      const active = player?.activeHeist;
      if (!active) continue;
      if (active.crew && active.leader && active.leader !== userId) continue; // the leader carries it
      if (now >= active.endsAt) {
        // eslint-disable-next-line no-await-in-loop -- boot-time, tiny N
        const outcome = await fireHeist(client, guildId, userId, { now });
        if (outcome) fired += 1;
      } else {
        armHeistTimer(client, guildId, userId, active.endsAt, { now });
        armed += 1;
      }
    }
  }
  if (armed || fired) {
    logger.info(`Heist: re-armed ${armed} running job(s), settled ${fired} that finished while offline.`);
  }
  return { armed, fired };
}
