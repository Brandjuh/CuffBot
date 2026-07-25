// Kill-counter storage and the per-channel silence timers (S99 = M20).
//
// Everything decidable lives in lib/killcounter.js with `now` injected; this
// file holds the store access and the one timer per channel. The timer is
// RAM-only and unref'd on purpose: a pending kill that a restart loses is one
// point in a game, and persisting a countdown would mean writing to the Pi's
// SD card on every message in the precinct.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import {
  DEFAULT_KILLCOUNTER_CONFIG,
  addKill,
  isEligible,
  noteSpeaker,
  resolveSilence,
} from './lib/killcounter.js';

export const KILLCOUNTER_CONFIG_KEY = 'killCounterConfig';
export const KILLCOUNTER_SCORES_KEY = 'killCounterScores';

export function getKillCounterConfig(guildId) {
  return { ...DEFAULT_KILLCOUNTER_CONFIG, ...getGuildData(guildId, KILLCOUNTER_CONFIG_KEY, {}) };
}

export function setKillCounterConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, KILLCOUNTER_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, KILLCOUNTER_CONFIG_KEY, stored);
  return { ...DEFAULT_KILLCOUNTER_CONFIG, ...stored };
}

export function getScores(guildId) {
  return getGuildData(guildId, KILLCOUNTER_SCORES_KEY, {});
}

export function resetScores(guildId) {
  setGuildData(guildId, KILLCOUNTER_SCORES_KEY, {});
}

/** Credit one kill, persisted. Returns the member's new total. */
export function recordKill(guildId, userId, now = Date.now()) {
  let total = 0;
  updateGuildData(guildId, KILLCOUNTER_SCORES_KEY, (scores = {}) => {
    const next = addKill(scores, userId, now);
    total = next[userId].kills;
    return next;
  });
  return total;
}

// channelId → { pending, timer }. RAM only, by design (see the file header).
const channels = new Map();

/** Drop every armed timer — tests and a clean shutdown. */
export function resetKillCounterState() {
  for (const entry of channels.values()) clearTimeout(entry.timer);
  channels.clear();
}

/** What is currently pending in a channel (tests and diagnostics). */
export const pendingIn = (channelId) => channels.get(channelId)?.pending ?? null;

/**
 * A member spoke. Replaces whatever was pending in this channel — the
 * replacement IS the reset — and re-arms the silence timer.
 *
 * @param {object} message a real Message or the shape isEligible needs
 * @param {object} [io] injectable timers, so tests never wait
 * @returns {boolean} whether this message is now holding the knife
 */
export function noteMessage(guildId, message, { now = Date.now(), setTimer, clearTimer } = {}) {
  const config = getKillCounterConfig(guildId);
  const arm = setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const disarm = clearTimer ?? ((t) => clearTimeout(t));

  const shape = {
    authorIsBot: Boolean(message.author?.bot),
    content: message.content ?? '',
    channelId: message.channelId ?? message.channel?.id,
  };
  const prefix = message.client?.config?.prefix ?? '!';
  if (!isEligible(shape, config, prefix)) return false;

  const channelId = shape.channelId;
  const existing = channels.get(channelId);
  if (existing?.timer) disarm(existing.timer);

  const pending = noteSpeaker(message.author.id, now);
  const timer = arm(() => {
    fireSilence(guildId, channelId).catch(() => {});
  }, config.silenceMs);
  timer?.unref?.(); // never hold the process open for a game point
  channels.set(channelId, { pending, timer });
  return true;
}

/**
 * The silence elapsed. Awards the pending speaker if they really did go quiet
 * — `resolveSilence` clears the pending as it awards, so a duplicate tick
 * cannot double-score.
 *
 * @returns {Promise<{ userId: string, total: number }|null>}
 */
export async function fireSilence(guildId, channelId, { now = Date.now() } = {}) {
  const entry = channels.get(channelId);
  if (!entry) return null;
  const config = getKillCounterConfig(guildId);
  const { pending, award } = resolveSilence(entry.pending, now, config.silenceMs);
  if (!award) {
    channels.set(channelId, { ...entry, pending });
    return null;
  }
  channels.delete(channelId);
  return { userId: award, total: recordKill(guildId, award, now) };
}
