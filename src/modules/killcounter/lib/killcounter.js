// The chat kill counter (S99 = M20, owner request): "zodra het 30 seconden
// stil is nadat een persoon wat heeft gezegd krijgt die persoon 1 punt op de
// kill counter". You killed the conversation; you get the credit.
//
// Pure, with `now` injected everywhere — the timing is the whole feature, so
// it must be testable without a test that actually waits 30 seconds. The real
// timer in service.js does nothing but call `resolveSilence` on schedule.

export const DEFAULT_KILLCOUNTER_CONFIG = {
  enabled: true,
  silenceMs: 30_000, // owner: 30 seconds
  // Empty = every channel the bot can see. The owner's request did not say
  // whether it should be scoped, so the knob answers it either way; narrowing
  // is one command.
  channelIds: [],
  // A `!command` is someone talking to the bot, not to the room — counting it
  // would hand out points for running commands into a quiet channel.
  ignoreCommands: true,
};

/**
 * Is this message a "last word" that could kill the channel?
 *
 * @param {{ authorIsBot: boolean, content: string, channelId: string }} message
 * @param {object} config
 * @param {string} prefix
 */
export function isEligible(message, config, prefix = '!') {
  if (!config.enabled) return false;
  if (message.authorIsBot) return false;
  if (config.channelIds.length > 0 && !config.channelIds.includes(message.channelId)) return false;
  if (config.ignoreCommands && isCommandLine(message.content, prefix)) return false;
  return true;
}

/** The router's own rule: a lone prefix or "! spaced" is not a command. */
export function isCommandLine(content, prefix) {
  if (typeof content !== 'string' || !content.startsWith(prefix)) return false;
  const body = content.slice(prefix.length);
  return body.length > 0 && !/^\s/.test(body);
}

/**
 * Record who spoke last in a channel. Any new message REPLACES the pending
 * kill — that replacement is the reset, and it is why a busy channel never
 * scores: only the final speaker before the silence is holding the knife.
 *
 * @returns {{ userId: string, at: number }} the new pending state
 */
export function noteSpeaker(userId, now) {
  return { userId, at: now };
}

/**
 * Has the pending speaker earned the point yet?
 *
 * Returns the awarded userId **and a cleared pending**, which is what makes
 * scoring idempotent: a second call cannot award the same silence twice, so a
 * stray extra timer tick is harmless.
 *
 * @returns {{ pending: null|object, award: string|null }}
 */
export function resolveSilence(pending, now, silenceMs) {
  if (!pending) return { pending: null, award: null };
  if (now - pending.at < silenceMs) return { pending, award: null }; // spoke again recently
  return { pending: null, award: pending.userId };
}

/** Merge a kill into a scores map, returning a NEW map (never mutating). */
export function addKill(scores, userId, now) {
  const current = scores[userId] ?? { kills: 0, lastKillAt: 0 };
  return {
    ...scores,
    [userId]: { kills: current.kills + 1, lastKillAt: now },
  };
}

/** Highest kill count first; ties broken by the most recent kill. */
export function leaderboard(scores, limit = 10) {
  return Object.entries(scores ?? {})
    .map(([userId, record]) => ({
      userId,
      kills: record?.kills ?? 0,
      lastKillAt: record?.lastKillAt ?? 0,
    }))
    .filter((row) => row.kills > 0)
    .sort((a, b) => b.kills - a.kills || b.lastKillAt - a.lastKillAt)
    .slice(0, Math.max(1, limit));
}

/** Someone's own standing, including where they sit on the board. */
export function standingFor(scores, userId) {
  const all = leaderboard(scores, Number.MAX_SAFE_INTEGER);
  const index = all.findIndex((row) => row.userId === userId);
  return {
    kills: all[index]?.kills ?? 0,
    rank: index === -1 ? null : index + 1,
    of: all.length,
  };
}
