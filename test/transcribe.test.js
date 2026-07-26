// The transcription desk (S101 = M21.1, owner request: "voice memos worden in
// het engels getranscribeerd"). Every HTTP call is an injected fake — nothing
// here touches the network, and no GROQ_API_KEY is ever needed to run it.
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_TRANSCRIBE_CONFIG,
  MAX_AUDIO_BYTES,
  VOICE_MESSAGE_FLAG,
  audioAttachmentsOf,
  dayKey,
  eligibility,
  formatDuration,
  isAudioAttachment,
  isVoiceMessage,
  refusalFor,
  spendBudget,
  transcriptEmbed,
  truncateTranscript,
} from '../src/modules/transcribe/lib/transcribe.js';
import {
  TRANSCRIBE_MODEL,
  TRANSLATE_MODEL,
  downloadAudio,
  hasAudioKey,
  transcribeAudio,
} from '../src/modules/transcribe/lib/audio-provider.js';
import {
  claimBudget,
  getBudget,
  getTranscribeConfig,
  refundBudget,
  setTranscribeConfig,
  transcribeMessage,
} from '../src/modules/transcribe/service.js';
import transcribeCommand from '../src/modules/transcribe/commands/transcribe.js';
import { dispatchGroup } from '../src/core/prefix/group.js';
import { tokenize } from '../src/core/prefix/parse.js';
import { fakeMessage } from './fixtures/fake-message.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-transcribe-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `30000000000000${String((seq += 1)).padStart(4, '0')}`;
const ALICE = '800000000000000001';

/** A voice message the way Discord actually delivers one. */
function voiceMessage({
  guildId = '900000000000000001',
  channelId = 'chan-1',
  duration = 8,
  size = 12_000,
  bot = false,
} = {}) {
  return {
    id: 'msg-1',
    flags: VOICE_MESSAGE_FLAG,
    channelId,
    author: { id: ALICE, bot },
    attachments: new Map([
      [
        'a1',
        {
          name: 'voice-message.ogg',
          contentType: 'audio/ogg',
          url: 'https://cdn.example/voice-message.ogg',
          size,
          duration,
          waveform: 'AAAA',
        },
      ],
    ]),
  };
}

/** An ordinary attached audio file — no voice-message flag, no waveform. */
function fileMessage({ name = 'memo.mp3', contentType = 'audio/mpeg', size = 40_000 } = {}) {
  return {
    id: 'msg-2',
    flags: 0,
    channelId: 'chan-1',
    author: { id: ALICE, bot: false },
    attachments: new Map([
      ['a1', { name, contentType, url: `https://cdn.example/${name}`, size, duration: 0 }],
    ]),
  };
}

// ── what counts as audio ─────────────────────────────────────────────────────

test('audio is recognised by content-type first, extension second', () => {
  assert.equal(isAudioAttachment({ contentType: 'audio/ogg', name: 'blob' }), true);
  assert.equal(isAudioAttachment({ contentType: 'audio/mpeg; codecs=mp3', name: 'x' }), true);
  // Mobile clients and re-uploads routinely arrive with no content-type.
  assert.equal(isAudioAttachment({ contentType: null, name: 'memo.M4A' }), true, 'case-insensitive');
  assert.equal(isAudioAttachment({ contentType: '', name: 'note.flac' }), true);
  assert.equal(isAudioAttachment({ contentType: 'image/png', name: 'cat.png' }), false);
  assert.equal(isAudioAttachment({ contentType: null, name: 'notes' }), false, 'no extension');
  assert.equal(isAudioAttachment(null), false);
});

test('a voice message is told apart from an attached audio file', () => {
  assert.equal(isVoiceMessage(voiceMessage()), true, 'by the flag');
  assert.equal(isVoiceMessage(fileMessage()), false);
  // A BitField instead of a number — what discord.js hands over in some paths.
  assert.equal(isVoiceMessage({ ...fileMessage(), flags: { bitfield: VOICE_MESSAGE_FLAG } }), true);
  // No flag at all, but the attachment carries a waveform: still a voice note.
  const waveformOnly = fileMessage();
  waveformOnly.attachments.get('a1').waveform = 'AAAA';
  assert.equal(isVoiceMessage(waveformOnly), true, 'waveform is the fallback');
});

test('audioAttachmentsOf handles both a Collection and a plain array, and filters', () => {
  assert.equal(audioAttachmentsOf(voiceMessage()).length, 1);
  const mixed = {
    attachments: [
      { name: 'cat.png', contentType: 'image/png' },
      { name: 'memo.ogg', contentType: 'audio/ogg' },
      { name: 'notes.txt', contentType: 'text/plain' },
    ],
  };
  assert.deepEqual(
    audioAttachmentsOf(mixed).map((a) => a.name),
    ['memo.ogg'],
  );
  assert.deepEqual(audioAttachmentsOf({}), []);
  assert.deepEqual(audioAttachmentsOf(null), []);
});

// ── eligibility, one reason per refusal ──────────────────────────────────────

test('eligibility names WHY, because the command has to explain it', () => {
  const on = DEFAULT_TRANSCRIBE_CONFIG;

  assert.equal(eligibility(voiceMessage(), on).ok, true, 'a voice message is the default yes');
  assert.equal(eligibility(voiceMessage(), { ...on, enabled: false }).reason, 'disabled');
  assert.equal(eligibility(voiceMessage({ bot: true }), on).reason, 'bot');
  assert.equal(eligibility({ author: { id: ALICE }, attachments: new Map() }, on).reason, 'no-audio');
  assert.equal(
    eligibility(voiceMessage(), { ...on, channelIds: ['other-chan'] }).reason,
    'out-of-scope',
  );
  assert.equal(eligibility(voiceMessage(), { ...on, autoVoiceMessages: false }).reason, 'auto-off');
  // An ordinary audio FILE is off by default — it is as likely to be a song.
  assert.equal(eligibility(fileMessage(), on).reason, 'auto-off');
  assert.equal(eligibility(fileMessage(), { ...on, autoAudioFiles: true }).ok, true);
  assert.equal(eligibility(voiceMessage({ size: MAX_AUDIO_BYTES + 1 }), on).reason, 'too-large');
  assert.equal(eligibility(voiceMessage({ duration: 6_000 }), on).reason, 'too-long');
  assert.equal(
    eligibility(voiceMessage({ duration: 6_000 }), { ...on, maxDurationSecs: 0 }).ok,
    true,
    '0 means no duration limit',
  );
});

test('the manual command bypasses scope and the auto switches, but not the hard limits', () => {
  const off = { ...DEFAULT_TRANSCRIBE_CONFIG, enabled: false, channelIds: ['elsewhere'], autoVoiceMessages: false };
  assert.equal(eligibility(voiceMessage(), off, { manual: true }).ok, true);
  assert.equal(eligibility(fileMessage(), off, { manual: true }).ok, true, 'files too, on request');
  // Size and duration are the service's real ceilings, not preferences.
  assert.equal(
    eligibility(voiceMessage({ size: MAX_AUDIO_BYTES + 1 }), off, { manual: true }).reason,
    'too-large',
  );
  assert.equal(eligibility(voiceMessage({ bot: true }), off, { manual: true }).reason, 'bot');
});

test('only the FIRST audio attachment is transcribed', () => {
  const many = {
    author: { id: ALICE, bot: false },
    channelId: 'chan-1',
    flags: VOICE_MESSAGE_FLAG,
    attachments: [
      { name: 'first.ogg', contentType: 'audio/ogg', size: 1000, url: 'u1' },
      { name: 'second.ogg', contentType: 'audio/ogg', size: 1000, url: 'u2' },
    ],
  };
  // Transcribing all of them would multiply one message's cost by its file count.
  assert.equal(eligibility(many, DEFAULT_TRANSCRIBE_CONFIG).attachment.name, 'first.ogg');
});

// ── presentation ─────────────────────────────────────────────────────────────

test('durations read like durations', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(8), '8s');
  assert.equal(formatDuration(59.4), '59s');
  assert.equal(formatDuration(64), '1m 04s', 'seconds are zero-padded');
  assert.equal(formatDuration(750), '12m 30s');
});

test('a long transcript is cut at a word boundary and SAYS it was cut', () => {
  const short = truncateTranscript('Officer down on Fifth.');
  assert.equal(short.truncated, false);
  assert.equal(short.text, 'Officer down on Fifth.');

  const long = truncateTranscript(`${'word '.repeat(1200)}`, 200);
  assert.equal(long.truncated, true);
  assert.ok(long.text.length <= 200, 'fits the limit it was given');
  assert.match(long.text, /transcript truncated/, 'a silent half-statement would be worse');
  assert.doesNotMatch(long.text, /wor\n/, 'never mid-word');
});

test('the transcript embed states the speaker, the length and the language', () => {
  const embed = transcriptEmbed({ text: 'Suspect fled north.', authorId: ALICE, durationSecs: 8 });
  assert.equal(embed.description, 'Suspect fled north.');
  assert.deepEqual(embed.fields, [{ name: 'Speaker', value: `<@${ALICE}>`, inline: true }]);
  assert.match(embed.footer.text, /^8s · transcribed to English$/);

  const native = transcriptEmbed({ text: 'Hallo daar.', authorId: ALICE, translated: false, filename: 'memo.mp3' });
  assert.match(native.footer.text, /transcribed · memo\.mp3/);
  assert.doesNotMatch(native.footer.text, /English/);

  // Whisper returns an empty string for silence — say so rather than posting a blank card.
  assert.match(transcriptEmbed({ text: '   ', authorId: ALICE }).description, /no speech detected/);
});

test('every refusal reason has words, and an unknown one still does', () => {
  for (const reason of ['disabled', 'bot', 'no-audio', 'out-of-scope', 'auto-off', 'too-large', 'too-long', 'no-key', 'daily-limit']) {
    assert.ok(refusalFor(reason).length > 10, reason);
  }
  assert.ok(refusalFor('something-new').length > 10, 'no undefined leaks into a reply');
});

// ── the daily budget ─────────────────────────────────────────────────────────

test('the daily budget counts, blocks, and rolls over on its own', () => {
  const day1 = Date.parse('2026-07-26T10:00:00Z');
  const day2 = Date.parse('2026-07-27T00:05:00Z');
  assert.equal(dayKey(day1), '2026-07-26');

  let counter = { day: null, used: 0 };
  for (let i = 0; i < 3; i += 1) {
    const spent = spendBudget(counter, 3, day1);
    assert.equal(spent.allowed, true, `call ${i + 1} of 3`);
    counter = spent.counter;
  }
  assert.equal(spendBudget(counter, 3, day1).allowed, false, 'the fourth is refused');
  // No scheduled job clears this: a new UTC day simply is not the stored day.
  const tomorrow = spendBudget(counter, 3, day2);
  assert.equal(tomorrow.allowed, true);
  assert.deepEqual(tomorrow.counter, { day: '2026-07-27', used: 1 });

  assert.equal(spendBudget({ day: '2026-07-26', used: 9_999 }, 0, day1).allowed, true, '0 = uncapped');
});

// ── the Groq call, entirely through an injected fetch ────────────────────────

/** Records what was asked of it and answers however the test says. */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options);
  };
  impl.calls = calls;
  return impl;
}

const okJson = (body) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => 'application/json' } });

test('translating and transcribing hit different endpoints with different models', async () => {
  const seen = [];
  const impl = fakeFetch(async (url, options) => {
    seen.push({ url, model: options.body.get('model'), headers: options.headers });
    return okJson({ text: '  Suspect fled north.  ' });
  });
  const env = { GROQ_API_KEY: 'gsk_test' };
  const bytes = new Uint8Array([1, 2, 3]);

  const english = await transcribeAudio({ bytes, env, fetchImpl: impl, translate: true });
  assert.equal(english, 'Suspect fled north.', 'the transcript is trimmed');
  assert.match(seen[0].url, /\/audio\/translations$/);
  assert.equal(seen[0].model, TRANSLATE_MODEL, 'turbo cannot translate');

  await transcribeAudio({ bytes, env, fetchImpl: impl, translate: false });
  assert.match(seen[1].url, /\/audio\/transcriptions$/);
  assert.equal(seen[1].model, TRANSCRIBE_MODEL, 'and turbo is faster when it can be used');
});

test('the upload is multipart and sets no Content-Type by hand', async () => {
  // Setting Content-Type manually drops the multipart boundary and the upload
  // fails with an opaque 400 — this test exists because that is easy to "fix"
  // in the wrong direction.
  const impl = fakeFetch(async () => okJson({ text: 'ok' }));
  await transcribeAudio({
    bytes: new Uint8Array([1]),
    filename: 'voice-message.ogg',
    contentType: 'audio/ogg',
    env: { GROQ_API_KEY: 'gsk_test' },
    fetchImpl: impl,
  });
  const { options } = impl.calls[0];
  assert.ok(options.body instanceof FormData);
  assert.deepEqual(Object.keys(options.headers), ['Authorization']);
  assert.equal(options.headers.Authorization, 'Bearer gsk_test');
  assert.equal(options.body.get('temperature'), '0', 'Whisper invents speech when it is warmer');
  const file = options.body.get('file');
  assert.equal(file.type, 'audio/ogg');
  assert.equal(options.body.get('response_format'), 'json');
});

test('the provider fails loudly and never silently returns nothing', async () => {
  const env = { GROQ_API_KEY: 'gsk_test' };
  await assert.rejects(
    () => transcribeAudio({ bytes: new Uint8Array([1]), env: {}, fetchImpl: fakeFetch(async () => okJson({})) }),
    /no GROQ_API_KEY/,
  );
  await assert.rejects(
    () =>
      transcribeAudio({
        bytes: new Uint8Array([1]),
        env,
        fetchImpl: fakeFetch(async () => ({ ok: false, status: 429, text: async () => 'rate limited' })),
      }),
    /HTTP 429.*rate limited/,
  );
  await assert.rejects(
    () => transcribeAudio({ bytes: new Uint8Array([1]), env, fetchImpl: fakeFetch(async () => okJson({ nope: 1 })) }),
    /no text in response/,
  );
  assert.equal(hasAudioKey({}), false);
  assert.equal(hasAudioKey(env), true);
});

test('the download enforces the size ceiling on the actual bytes', async () => {
  const big = new Uint8Array(64);
  const impl = fakeFetch(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => big.buffer,
    headers: { get: () => 'audio/ogg' },
  }));
  const got = await downloadAudio('https://cdn.example/a.ogg', { fetchImpl: impl, maxBytes: 1024 });
  assert.equal(got.bytes.length, 64);
  assert.equal(got.contentType, 'audio/ogg');
  // Discord's advertised size is a claim; the bytes are the fact.
  await assert.rejects(() => downloadAudio('u', { fetchImpl: impl, maxBytes: 8 }), /over the 8 limit/);
  await assert.rejects(
    () => downloadAudio('u', { fetchImpl: fakeFetch(async () => ({ ok: false, status: 404 })) }),
    /HTTP 404/,
  );
});

// ── the service ──────────────────────────────────────────────────────────────

test('config is sparse: defaults live in code, only overrides are stored', () => {
  const guildId = freshGuildId();
  assert.deepEqual(getTranscribeConfig(guildId), DEFAULT_TRANSCRIBE_CONFIG);
  const next = setTranscribeConfig(guildId, { translateToEnglish: false });
  assert.equal(next.translateToEnglish, false);
  assert.equal(next.autoVoiceMessages, DEFAULT_TRANSCRIBE_CONFIG.autoVoiceMessages, 'untouched');
});

test('the budget is claimed before the work, and refunded when it never happened', () => {
  const guildId = freshGuildId();
  setTranscribeConfig(guildId, { dailyLimit: 2 });
  assert.equal(claimBudget(guildId), true);
  assert.equal(claimBudget(guildId), true);
  assert.equal(claimBudget(guildId), false, 'the third is over budget');
  refundBudget(guildId);
  assert.equal(claimBudget(guildId), true, 'a refunded slot is usable again');
  assert.equal(getBudget(guildId).used, 2);
});

/** A fetch that serves the CDN download and the Groq upload from one fake. */
const transcribingFetch = (text = 'Suspect fled north.') =>
  fakeFetch(async (url) => {
    if (url.startsWith('https://cdn.example/')) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'audio/ogg' } };
    }
    return okJson({ text });
  });

test('transcribeMessage downloads, transcribes and returns a ready embed', async () => {
  const guildId = freshGuildId();
  const impl = transcribingFetch();
  const result = await transcribeMessage(guildId, voiceMessage(), {
    env: { GROQ_API_KEY: 'gsk_test' },
    fetchImpl: impl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Suspect fled north.');
  assert.equal(result.embed.description, 'Suspect fled north.');
  assert.match(result.embed.footer.text, /8s · transcribed to English/);
  assert.equal(impl.calls.length, 2, 'one download, one transcription');
  assert.equal(getBudget(guildId).used, 1);
});

test('transcribeMessage refuses honestly instead of throwing', async () => {
  const guildId = freshGuildId();
  const impl = transcribingFetch();

  const noKey = await transcribeMessage(guildId, voiceMessage(), { env: {}, fetchImpl: impl });
  assert.deepEqual(noKey, { ok: false, reason: 'no-key' });
  assert.equal(impl.calls.length, 0, 'and never reaches the network');

  const ineligible = await transcribeMessage(guildId, fileMessage(), {
    env: { GROQ_API_KEY: 'k' },
    fetchImpl: impl,
  });
  assert.equal(ineligible.reason, 'auto-off');
  assert.equal(getBudget(guildId).used, 0, 'a refusal costs no budget');
});

test('an over-budget guild is told so, and a failure gives the slot back', async () => {
  const guildId = freshGuildId();
  setTranscribeConfig(guildId, { dailyLimit: 1 });
  const env = { GROQ_API_KEY: 'gsk_test' };

  assert.equal((await transcribeMessage(guildId, voiceMessage(), { env, fetchImpl: transcribingFetch() })).ok, true);
  const over = await transcribeMessage(guildId, voiceMessage(), { env, fetchImpl: transcribingFetch() });
  assert.equal(over.reason, 'daily-limit');

  // A failed attempt must not consume the precinct's budget.
  const guild2 = freshGuildId();
  const broken = fakeFetch(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
  const failed = await transcribeMessage(guild2, voiceMessage(), { env, fetchImpl: broken });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'failed');
  assert.match(failed.detail, /HTTP 500/);
  assert.equal(getBudget(guild2).used, 0, 'refunded');
});

// ── the command surface ──────────────────────────────────────────────────────

const SUBS = transcribeCommand.group.subcommands;
const runGroup = (message, line) =>
  dispatchGroup(transcribeCommand.group, message, tokenize(line), '!');

test('the group offers exactly the documented subcommands', () => {
  assert.deepEqual(
    SUBS.map((s) => s.name),
    // S102 added the live-voice trio (join/leave/timestamps).
    ['now', 'join', 'leave', 'timestamps', 'on', 'off', 'auto', 'english', 'channel', 'everywhere', 'limit'],
  );
  assert.deepEqual(transcribeCommand.group.aliases, ['stt', 'statement']);
});

test('reading is public; every knob is Manage Server', () => {
  const open = SUBS.filter((s) => !s.permission).map((s) => s.name);
  assert.deepEqual(open, ['now'], 'only the on-demand transcription is unguarded');
  for (const sub of SUBS.filter((s) => s.permission)) {
    assert.equal(sub.permission, PermissionFlagsBits.ManageGuild, sub.name);
  }
});

test('bare !transcribe reports the desk’s state, including a missing key', async () => {
  const guildId = freshGuildId();
  const message = fakeMessage({ guildId });
  const hadKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    await runGroup(message, '');
  } finally {
    if (hadKey !== undefined) process.env.GROQ_API_KEY = hadKey;
  }
  const body = JSON.stringify(message.sent[0].embeds[0]);
  assert.match(body, /GROQ_API_KEY/, 'an unconfigured desk says so where an admin will look');
  assert.match(body, /always English/);
  assert.match(body, /everywhere/);
});

test('!transcribe now says so plainly when there is nothing to transcribe', async () => {
  const message = fakeMessage({ guildId: freshGuildId() });
  message.channel.messages = { fetch: async () => new Map() };
  await runGroup(message, 'now');
  assert.match(message.sent[0].content, /No recording found/);
});

test('!transcribe now finds the message you replied to', async () => {
  const guildId = freshGuildId();
  const message = fakeMessage({ guildId });
  const target = voiceMessage({ guildId });
  message.reference = { messageId: target.id };
  message.channel.messages = {
    fetch: async (id) => {
      assert.equal(id, target.id, 'the reply is the precise way to point at a recording');
      return target;
    },
  };
  process.env.GROQ_API_KEY = 'gsk_test';
  try {
    // The command path uses the real global fetch, so point the attachment at a
    // guaranteed refusal instead: what this test pins is the LOOKUP.
    target.attachments.get('a1').size = MAX_AUDIO_BYTES + 1;
    await runGroup(message, 'now');
  } finally {
    delete process.env.GROQ_API_KEY;
  }
  assert.equal(message.typing.count, 1, 'a network round-trip shows a typing indicator');
  assert.match(message.sent.at(-1).content, /over the 25 MB/);
});

test('the knobs write what they say they write', async () => {
  const guildId = freshGuildId();
  const message = fakeMessage({ guildId });

  await runGroup(message, 'off');
  assert.equal(getTranscribeConfig(guildId).enabled, false);
  await runGroup(message, 'on');
  assert.equal(getTranscribeConfig(guildId).enabled, true);

  await runGroup(message, 'english false');
  assert.equal(getTranscribeConfig(guildId).translateToEnglish, false);
  assert.match(message.sent.at(-1).content, /language that was spoken/);

  await runGroup(message, 'auto files true');
  assert.equal(getTranscribeConfig(guildId).autoAudioFiles, true);
  await runGroup(message, 'auto voice false');
  assert.equal(getTranscribeConfig(guildId).autoVoiceMessages, false);

  await runGroup(message, 'limit duration 120');
  assert.equal(getTranscribeConfig(guildId).maxDurationSecs, 120);
  await runGroup(message, 'limit daily 0');
  assert.equal(getTranscribeConfig(guildId).dailyLimit, 0);
  assert.match(message.sent.at(-1).content, /No daily transcription limit/);
});

test('the channel list toggles, and emptying it means everywhere again', async () => {
  const guildId = freshGuildId();
  // A real snowflake: the channel resolver applies Discord's own id rule, so
  // a friendly test id like 'chan-9' is rejected exactly as it should be (S93).
  const CHAN = '625276074833608705';
  const channel = { id: CHAN, type: 0, toString: () => `<#${CHAN}>` };
  const message = fakeMessage({ guildId, channels: { [CHAN]: channel } });

  await runGroup(message, `channel <#${CHAN}>`);
  assert.deepEqual(getTranscribeConfig(guildId).channelIds, [CHAN]);
  await runGroup(message, `channel <#${CHAN}>`);
  assert.deepEqual(getTranscribeConfig(guildId).channelIds, [], 'the same channel toggles off');
  assert.match(message.sent.at(-1).content, /every.*channel again/);

  await runGroup(message, `channel <#${CHAN}>`);
  await runGroup(message, 'everywhere');
  assert.deepEqual(getTranscribeConfig(guildId).channelIds, []);
});
