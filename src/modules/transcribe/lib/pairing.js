// Pairing a voice channel with its text channel by NAME (S110, owner: "De
// voice en text kanalen hebben dezelfde naam dus je kunt meteen een transcribe
// maken in het juiste tekst kanaal").
//
// "Same name" is not string equality. Discord lowercases text-channel names
// and turns spaces into hyphens, so `🎙️ Squad Room` as a voice channel is
// `squad-room` — or `🎙️-squad-room` — as a text one. Every rule below exists
// because one of those forms is what a real server actually has.
//
// Pure: takes plain `{ id, name, type }` objects and returns an id. No
// discord.js, so the whole matcher is testable without a guild.

/**
 * Reduce a channel name to what it is actually *called*.
 *
 * Strips the decoration servers put in names — emoji, box-drawing, separators,
 * the leading `・` and `|` people use as dividers — then folds accents,
 * collapses every run of non-alphanumerics into a single hyphen, and trims.
 */
export function normalizeChannelName(name) {
  return (
    String(name ?? '')
      .normalize('NFKD')
      // Combining marks: `café` and `cafe` are the same room.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // Anything that is not a letter or a digit is a separator. That covers
      // emoji, ・, |, —, and the hyphens Discord already inserted.
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

/**
 * Find the text channel that goes with `voiceChannel`.
 *
 * Three passes, most specific first — a wrong pairing posts a private
 * conversation into the wrong room, so a near-miss must never win over an
 * exact one:
 *   1. **Normalised equality** — `🎙️ Squad Room` ↔ `squad-room`.
 *   2. **Same category, normalised equality** is already covered by (1); the
 *      second pass is same-category *containment*, for `squad-room-chat`.
 *   3. Nothing. The caller falls back to the voice channel's own built-in
 *      text chat, which is always correct and never a guess.
 *
 * @param {{id: string, name: string, parentId?: string|null}} voiceChannel
 * @param {Array<{id: string, name: string, parentId?: string|null, isTextBased?: boolean}>} textChannels
 * @returns {{ id: string, how: 'exact'|'category' }|null}
 */
export function pairTextChannel(voiceChannel, textChannels) {
  const target = normalizeChannelName(voiceChannel?.name);
  if (target.length === 0) return null;
  const usable = textChannels.filter((c) => c && c.id !== voiceChannel.id);

  const exact = usable.filter((c) => normalizeChannelName(c.name) === target);
  if (exact.length === 1) return { id: exact[0].id, how: 'exact' };
  if (exact.length > 1) {
    // Two rooms with the same name: prefer the one in the same category, which
    // is what a duplicated name almost always means.
    const sameCategory = exact.find((c) => c.parentId && c.parentId === voiceChannel.parentId);
    return { id: (sameCategory ?? exact[0]).id, how: 'exact' };
  }

  // Only inside the same category — a `general` voice channel must not adopt
  // `general-announcements` from the other side of the server.
  if (voiceChannel?.parentId) {
    const near = usable.filter(
      (c) => c.parentId === voiceChannel.parentId && normalizeChannelName(c.name).includes(target),
    );
    if (near.length === 1) return { id: near[0].id, how: 'category' };
  }
  return null;
}

/**
 * Should the bot join this voice channel right now?
 *
 * @param {{ humans: number, channelId: string }} state
 * @returns {{ ok: boolean, reason: string }}
 */
export function shouldAutoJoin(state, config) {
  if (!config.autoJoin) return { ok: false, reason: 'auto-join-off' };
  if (!config.enabled) return { ok: false, reason: 'disabled' };
  if (state.humans < (config.autoJoinMinimum ?? 1)) return { ok: false, reason: 'too-quiet' };
  if (config.voiceChannelIds?.length > 0 && !config.voiceChannelIds.includes(state.channelId)) {
    return { ok: false, reason: 'out-of-scope' };
  }
  return { ok: true, reason: 'ok' };
}

/**
 * Should the bot leave? The bot itself never counts — otherwise it would sit
 * alone in an empty channel forever, transcribing its own silence and burning
 * the Pi's CPU.
 */
export const shouldAutoLeave = (humans) => humans === 0;

/** Humans (not bots) in a voice channel, from its member collection. */
export function humansIn(voiceChannel) {
  const members = voiceChannel?.members;
  if (!members) return 0;
  const list = typeof members.values === 'function' ? [...members.values()] : Array.isArray(members) ? members : [];
  return list.filter((m) => !m?.user?.bot).length;
}
