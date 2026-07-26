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
 * The precinct's own voice → text pairings (owner, 2026-07-26, given as ids).
 *
 * Committed as a code default rather than left for an admin to configure
 * (S35): the owner named concrete ids in chat, so they belong in the repo and
 * work the moment the Pi self-updates. A guild's stored `voicePairs` still
 * wins, because config storage is sparse.
 *
 * These take priority over the name matcher below. An explicit pairing is a
 * statement of fact; a name match is an inference, and an inference must never
 * beat a fact.
 */
// ⚠️ The keys are STRINGS on purpose. An unquoted 18-digit snowflake is a
// JavaScript *number*, and Number cannot hold it: `411633952961593345`
// silently becomes `411633952961593340`, so the lookup would never match a
// real channel id. This bug is invisible — the object looks correct in source
// and the map simply never hits.
export const DEFAULT_VOICE_PAIRS = {
  '411633952961593345': '411634025426321438',
  '436248103310327808': '436248239855894538',
  '442066086159187978': '442059736263688213',
  '411634241965916191': '411634286655963146',
};

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
 *   0. **A declared pairing** (`DEFAULT_VOICE_PAIRS`, or a guild's own) — a
 *      fact, not an inference, so it beats everything below.
 *   1. **Normalised equality** — `🎙️ Squad Room` ↔ `squad-room`.
 *   2. **Same category, normalised equality** is already covered by (1); the
 *      second pass is same-category *containment*, for `squad-room-chat`.
 *   3. Nothing. The caller falls back to the voice channel's own built-in
 *      text chat, which is always correct and never a guess.
 *
 * @param {{id: string, name: string, parentId?: string|null}} voiceChannel
 * @param {Array<{id: string, name: string, parentId?: string|null, isTextBased?: boolean}>} textChannels
 * @returns {{ id: string, how: 'declared'|'exact'|'category' }|null}
 */
export function pairTextChannel(voiceChannel, textChannels, pairs = DEFAULT_VOICE_PAIRS) {
  // 0. An explicit pairing wins outright. The owner said which text channel
  //    goes with which voice channel; nothing inferred from a name may
  //    override that, even a perfect name match.
  const declared = pairs?.[voiceChannel?.id];
  if (declared) {
    // Only if the channel actually exists — a stale id must fall through to
    // the matcher rather than sending the transcript into a void.
    if (textChannels.some((c) => c?.id === declared)) return { id: declared, how: 'declared' };
  }

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

/**
 * Why auto-join would or would not fire right now (S117).
 *
 * The owner reported *"de bot joint niet automatisch de VC"* and had no way to
 * find out why: every refusal in the handler is a silent `return`, which is
 * right for a background feature and useless for diagnosing one. This turns
 * the same conditions into a sentence for the bare `!transcribe` status, so
 * the answer is one command away instead of a journal dive.
 *
 * @returns {{ ok: boolean, reason: string, detail: string }}
 */
export function autoJoinDiagnosis(config, { hasKey, inVoice }) {
  if (!config.enabled) {
    return { ok: false, reason: 'disabled', detail: 'the desk is off — `!transcribe on`' };
  }
  if (!config.autoJoin) {
    return { ok: false, reason: 'auto-join-off', detail: 'auto-join is off — `!transcribe autojoin true`' };
  }
  if (!hasKey) {
    return { ok: false, reason: 'no-key', detail: 'no `GROQ_API_KEY` on the host — joining would do nothing, so it stays out' };
  }
  if (inVoice) {
    return { ok: false, reason: 'busy', detail: 'already recording a channel — one at a time' };
  }
  if (config.voiceChannelIds?.length > 0) {
    return {
      ok: true,
      reason: 'scoped',
      detail: `armed, but only for ${config.voiceChannelIds.map((id) => `<#${id}>`).join(', ')}`,
    };
  }
  const minimum = config.autoJoinMinimum ?? 1;
  return {
    ok: true,
    reason: 'ok',
    detail: `armed — I follow the first ${minimum === 1 ? 'person' : `${minimum} people`} into any voice channel`,
  };
}

/**
 * Where EVERY voice channel's transcript would go (S118, owner: *"voeg een
 * optie toe dat ik kan zien welke VC kanalen aan welke kanalen zijn
 * gekoppeld"*).
 *
 * `!transcribe pairs` used to list only the four stored pairings, which
 * answers "what is configured" rather than the question actually asked. Most
 * voice channels are matched by NAME and appeared nowhere, so the majority of
 * the answer was missing — and a pairing whose channel had since been deleted
 * rendered as a broken `<#id>` mention with no hint that it was stale.
 *
 * This walks the voice channels instead of the pairing table, so every room is
 * accounted for and each row says WHY it resolves where it does.
 *
 * @param {Array<{id,name,parentId?}>} voiceChannels
 * @param {Array<{id,name,parentId?}>} textChannels
 * @param {Record<string,string>} pairs        declared pairs (defaults + guild)
 * @param {Record<string,string>} guildPairs   this server's own overrides only
 * @returns {{rows: Array<object>, orphans: Array<{voiceId,textId,fromDefault:boolean}>}}
 */
export function describePairings(voiceChannels, textChannels, pairs = {}, guildPairs = {}) {
  const known = new Set(voiceChannels.map((c) => c.id));
  const textById = new Map(textChannels.map((c) => [c.id, c]));

  const rows = voiceChannels.map((voice) => {
    const declared = pairs[voice.id];
    const match = pairTextChannel(voice, textChannels, pairs);
    return {
      voiceId: voice.id,
      voiceName: voice.name,
      textId: match?.id ?? null,
      how: match?.how ?? 'built-in',
      overridden: Object.hasOwn(guildPairs, voice.id),
      // A declared target that no longer exists: the matcher silently fell
      // through to a name match, which is right behaviour and confusing to
      // read unless the row says so.
      staleTarget: Boolean(declared) && !textById.has(declared) ? declared : null,
    };
  });

  // Pairings pointing at a voice channel that is gone. They do no harm, but
  // they are the rows an admin would want to clean up — and `unpair` cannot
  // take a channel argument for a channel that no longer resolves, which is
  // why it accepts a raw id.
  const orphans = Object.entries(pairs)
    .filter(([voiceId]) => !known.has(voiceId))
    .map(([voiceId, textId]) => ({ voiceId, textId, fromDefault: DEFAULT_VOICE_PAIRS[voiceId] === textId }));

  return { rows, orphans };
}

/** How a resolved pairing reads in the list. */
export const HOW_LABEL = {
  declared: "paired",
  exact: "matched by name",
  category: "matched by name (same category)",
  "built-in": "its own built-in chat",
};
