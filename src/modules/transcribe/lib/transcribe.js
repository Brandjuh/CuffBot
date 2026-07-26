// Voice-memo transcription rules (S101 = M21.1, owner request: "voice chats en
// voice memos worden in het engels getranscribeerd"). Pure — no discord.js, no
// network — so every decision here is testable against a plain object.
//
// The module never touches the voice gateway: a voice message is an ordinary
// attachment on an ordinary message, so this half is "download a file and POST
// it", which is why it ships with zero new dependencies.

/** Discord sets this message flag on its native voice-message feature. */
export const VOICE_MESSAGE_FLAG = 1 << 13; // 8192

/**
 * Groq's audio endpoints cap uploads at 25 MB on the free tier. A Discord
 * voice message is far below this; an uploaded podcast is not, and refusing it
 * with a clear reason beats letting Groq return an opaque 413.
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * What counts as audio. Discord voice messages are always `audio/ogg`, but
 * members attach all of these, and content-type is missing often enough
 * (mobile clients, re-uploads) that the extension has to be a fallback rather
 * than a nicety.
 */
export const AUDIO_EXTENSIONS = [
  'ogg',
  'oga',
  'opus',
  'mp3',
  'm4a',
  'mp4',
  'wav',
  'webm',
  'flac',
  'mpga',
  'mpeg',
];

export const DEFAULT_TRANSCRIBE_CONFIG = {
  enabled: true,
  /** Empty = every channel, the same convention the kill counter uses (S99). */
  channelIds: [],
  /**
   * Auto-transcribe Discord's native voice messages. These are unambiguous —
   * someone recorded a message *for this channel* — so they are the case where
   * transcribing uninvited is helpful rather than presumptuous.
   */
  autoVoiceMessages: true,
  /**
   * Auto-transcribe ordinary attached audio files too. Off by default: an
   * attached .mp3 is as likely to be a song as a memo, and burning API budget
   * on someone's music is the wrong default. `!transcribe` handles them
   * on demand.
   */
  autoAudioFiles: false,
  /**
   * English out, whatever went in — the owner's literal request. Groq exposes
   * this as a separate *translation* endpoint; turning it off transcribes in
   * the spoken language instead.
   */
  translateToEnglish: true,
  /** Skip anything longer than this. 0 = no limit. */
  maxDurationSecs: 600,
  /**
   * Per-guild daily ceiling on transcriptions, so a spammer cannot drain the
   * free tier. Live voice (S102) spends from the same budget — one turn in a
   * voice channel costs exactly what one voice memo costs.
   */
  // S123: 0 = "only Groq's own limits apply". This used to be 100, invented in
  // S101 when memos were the only spender; the real ceilings live in
  // `lib/limits.js` and come from Groq's published free tier. Set a number
  // here only to spend LESS than Groq allows.
  dailyLimit: 0,
  /** S102: prefix each live-voice line with an HH:MM (UTC) stamp. */
  voiceTimestamps: true,
  /**
   * S110 (owner request): join a voice channel by itself the moment somebody
   * is in it, and transcribe into the text channel with the matching name.
   * ON by default because the owner asked for exactly that — `!transcribe
   * autojoin false` is the off switch.
   */
  autoJoin: true,
  /** **Empty = every voice channel.** A non-empty list restricts auto-join. */
  voiceChannelIds: [],
  /** How many humans must be in the channel before the bot bothers. */
  autoJoinMinimum: 1,
  /**
   * Explicit voice → text pairings, `{ voiceChannelId: textChannelId }`.
   * Merged OVER `DEFAULT_VOICE_PAIRS` (the owner's own, committed in
   * `lib/pairing.js`), so a guild can correct a default without editing code.
   */
  voicePairs: {},
  // S117, owner: "Is er ook een manier om muziek te negeren?" — yes, and this
  // is the case that actually matters. A music bot in the channel is a normal
  // speaker to the receiver, so its stream was captured, uploaded to Whisper
  // and transcribed as garbled lyrics, spending the daily budget on it.
  ignoreBots: true,
  // Anyone else who should never be transcribed (a soundboard account, a
  // member who asked not to be). Ids as STRINGS — a bare snowflake is rounded.
  ignoredUserIds: [],
};

/**
 * Does this attachment look like audio? Content-type wins when present;
 * otherwise the extension decides.
 * @param {{ contentType?: string|null, name?: string|null }} attachment
 */
export function isAudioAttachment(attachment) {
  if (!attachment) return false;
  const type = (attachment.contentType ?? '').toLowerCase();
  if (type.startsWith('audio/')) return true;
  // `video/webm` and `video/mp4` carry audio and Whisper accepts both, but a
  // real video is a big upload for one line of speech — leave those to the
  // extension check below so an explicit `.webm` audio note still works.
  const name = (attachment.name ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return AUDIO_EXTENSIONS.includes(name.slice(dot + 1));
}

/**
 * Is this message one of Discord's native voice messages? The flag is the
 * authority; the waveform is the fallback for shapes that do not carry flags
 * (older cached messages, and every test fixture that would otherwise have to
 * know the bit).
 */
export function isVoiceMessage(message) {
  const flags = message?.flags;
  const bits = typeof flags === 'number' ? flags : (flags?.bitfield ?? 0);
  if (Number(bits) & VOICE_MESSAGE_FLAG) return true;
  return audioAttachmentsOf(message).some((a) => typeof a.waveform === 'string' && a.waveform !== '');
}

/** Every audio attachment on a message, in order. */
export function audioAttachmentsOf(message) {
  const raw = message?.attachments;
  if (!raw) return [];
  const list = typeof raw.values === 'function' ? [...raw.values()] : Array.isArray(raw) ? raw : [];
  return list.filter(isAudioAttachment);
}

/**
 * Should the bot transcribe this message on its own?
 *
 * Returns a REASON rather than a boolean because the manual command reuses the
 * same rules and has to explain a refusal — "too long", "no audio here" and
 * "that channel is not covered" are three different conversations.
 *
 * @returns {{ ok: boolean, reason: string, attachment?: object }}
 */
export function eligibility(message, config, { manual = false } = {}) {
  const settings = { ...DEFAULT_TRANSCRIBE_CONFIG, ...config };
  if (!manual && !settings.enabled) return { ok: false, reason: 'disabled' };
  if (message?.author?.bot) return { ok: false, reason: 'bot' };

  const attachments = audioAttachmentsOf(message);
  if (attachments.length === 0) return { ok: false, reason: 'no-audio' };

  if (!manual) {
    const channelId = message.channelId ?? message.channel?.id;
    if (settings.channelIds.length > 0 && !settings.channelIds.includes(channelId)) {
      return { ok: false, reason: 'out-of-scope' };
    }
    const voice = isVoiceMessage(message);
    if (voice && !settings.autoVoiceMessages) return { ok: false, reason: 'auto-off' };
    if (!voice && !settings.autoAudioFiles) return { ok: false, reason: 'auto-off' };
  }

  // The first audio attachment is the memo. Transcribing all of them would
  // multiply the cost of one message by however many files it carried.
  const attachment = attachments[0];
  if (Number(attachment.size) > MAX_AUDIO_BYTES) return { ok: false, reason: 'too-large', attachment };
  const duration = Number(attachment.duration ?? attachment.durationSecs ?? 0);
  if (settings.maxDurationSecs > 0 && duration > settings.maxDurationSecs) {
    return { ok: false, reason: 'too-long', attachment };
  }
  return { ok: true, reason: 'ok', attachment };
}

/** Human-readable duration: 8s, 1m 04s, 12m 30s. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

/**
 * Fit a transcript into a Discord embed description, cutting at a word
 * boundary and saying so. A silently halved statement is worse than a short
 * one — the reader cannot tell which they are looking at.
 */
export function truncateTranscript(text, limit = 3900) {
  const clean = String(text ?? '').trim();
  if (clean.length <= limit) return { text: clean, truncated: false };
  const notice = '\n\n… *(transcript truncated)*';
  const room = limit - notice.length;
  const cut = clean.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  return { text: `${(lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}${notice}`, truncated: true };
}

/**
 * The reply the precinct sees. Pure: takes the facts, returns the embed data,
 * so the wording is testable without a gateway.
 *
 * @param {{ text: string, authorId: string, durationSecs?: number,
 *           translated?: boolean, filename?: string }} result
 */
export function transcriptEmbed({ text, authorId, durationSecs = 0, translated = true, filename }) {
  const { text: body, truncated } = truncateTranscript(text);
  const parts = [];
  if (durationSecs > 0) parts.push(formatDuration(durationSecs));
  parts.push(translated ? 'transcribed to English' : 'transcribed');
  if (filename) parts.push(filename);
  return {
    color: 0x2f6f9f,
    title: '🎙️ Statement on the record',
    description: body.length > 0 ? body : '*(no speech detected)*',
    footer: { text: parts.join(' · ') },
    fields: [{ name: 'Speaker', value: `<@${authorId}>`, inline: true }],
    truncated,
  };
}

/** Why the bot said no, in the precinct's words. */
export const REFUSALS = {
  disabled: 'Transcription is switched off in this precinct.',
  bot: 'That message is from a bot.',
  'no-audio': 'There is no audio attached to that message.',
  'out-of-scope': 'That channel is not covered by the transcription desk.',
  'auto-off': 'Automatic transcription is off for that kind of attachment.',
  'too-large': `That file is over the ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))} MB the transcription service accepts.`,
  'too-long': 'That recording is longer than the configured limit.',
  'no-key': 'No transcription service is configured. The owner must add `GROQ_API_KEY` to `.env` on the Pi and restart.',
  'daily-limit': 'The precinct has used its transcription budget for today. It resets at midnight UTC.',
};

export const refusalFor = (reason) => REFUSALS[reason] ?? 'That recording cannot be transcribed.';

/** UTC day stamp — the window the daily limit counts against. */
export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/**
 * Spend one unit of today's budget. Returns the new counter and whether the
 * caller may proceed; rolling over to a new day resets the count, so no
 * scheduled job is needed to clear it.
 */
export function spendBudget(counter, limit, now = Date.now()) {
  const today = dayKey(now);
  const used = counter?.day === today ? Number(counter.used) || 0 : 0;
  if (limit > 0 && used >= limit) return { counter: { day: today, used }, allowed: false };
  return { counter: { day: today, used: used + 1 }, allowed: true };
}

/**
 * Should this speaker be transcribed at all? (S117)
 *
 * Returns a reason rather than a boolean so the caller can log a skip that
 * looks like a bug ("the bot ignored me") differently from one that is the
 * whole point ("it ignored the music bot").
 *
 * @param {{ id: string, bot?: boolean }} speaker
 * @returns {{ listen: boolean, reason: 'ok'|'bot'|'ignored' }}
 */
export function speakerEligibility(speaker, config = DEFAULT_TRANSCRIBE_CONFIG) {
  if (config.ignoreBots !== false && speaker?.bot) return { listen: false, reason: 'bot' };
  if ((config.ignoredUserIds ?? []).includes(speaker?.id)) return { listen: false, reason: 'ignored' };
  return { listen: true, reason: 'ok' };
}
