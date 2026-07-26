// The live-voice capture (S102 = M21.2). This is the only file in CuffBot that
// touches the voice gateway, and it is deliberately thin: every rule it obeys
// lives in ../lib/voice-session.js, and the container it produces comes from
// ../lib/ogg.js. What is left here is plumbing that cannot be tested without a
// real gateway, which is exactly why there is so little of it.
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from '@discordjs/voice';
import { logger } from '../../../core/logger.js';
import { encodeOggOpus } from '../lib/ogg.js';
import {
  DEFAULT_VOICE_POLICY,
  createLineBuffer,
  formatLine,
  isOverCap,
  isWorthTranscribing,
  packLines,
  shouldFlush,
} from '../lib/voice-session.js';
import { getTranscribeConfig, transcribeBuffer } from '../service.js';

/** guildId → { connection, channelId, textChannel, buffer, timer, speakers } */
const sessions = new Map();

export const sessionFor = (guildId) => sessions.get(guildId) ?? null;
export const isListening = (guildId) => sessions.has(guildId);

/**
 * Join a voice channel and start writing down what is said.
 *
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function startListening(guild, voiceChannel, textChannel) {
  if (sessions.has(guild.id)) return { ok: false, reason: 'already-listening' };

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    // The bot only listens. Deafening itself would stop the receiver, but
    // muting costs nothing and tells everyone in the channel that CuffBot is
    // not going to talk back.
    selfDeaf: false,
    selfMute: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (error) {
    connection.destroy();
    logger.warn(`Transcribe: could not join ${voiceChannel.id}:`, error);
    return { ok: false, reason: 'join-failed' };
  }

  const session = {
    connection,
    channelId: voiceChannel.id,
    textChannel,
    buffer: createLineBuffer(),
    timer: null,
    speakers: new Set(),
  };
  sessions.set(guild.id, session);

  // A dropped websocket reconnects on its own; a real disconnect must not
  // leave a dead session in the map pretending to listen.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      stopListening(guild.id);
    }
  });

  connection.receiver.speaking.on('start', (userId) => {
    captureSpeaker(guild, userId).catch((error) =>
      logger.warn(`Transcribe: capture failed for ${userId}:`, error),
    );
  });

  session.timer = setInterval(() => flush(guild.id).catch(() => {}), 2_000);
  session.timer.unref?.();
  return { ok: true };
}

/** Leave the channel, flushing whatever is still buffered. */
export function stopListening(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  sessions.delete(guildId);
  clearInterval(session.timer);
  flushNow(session).catch(() => {});
  try {
    session.connection.destroy();
  } catch {
    // Already gone — the point was to not be connected.
  }
  return true;
}

/** Tests and shutdown: drop every session without touching Discord twice. */
export function resetVoiceSessions() {
  for (const guildId of [...sessions.keys()]) stopListening(guildId);
}

/**
 * Record one speaker's turn. The receiver ends the stream after the configured
 * silence, which is what makes a "turn" a natural unit rather than a fixed
 * window — and the packets it yields are Opus, so they go straight into an Ogg
 * container with no decoding.
 */
async function captureSpeaker(guild, userId) {
  const session = sessions.get(guild.id);
  if (!session) return;
  // One subscription per speaker at a time; `speaking.start` fires again for
  // every burst, and a second stream would duplicate every word.
  if (session.speakers.has(userId)) return;
  session.speakers.add(userId);

  const policy = { ...DEFAULT_VOICE_POLICY };
  const stream = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: policy.silenceMs },
  });

  const packets = [];
  try {
    for await (const packet of stream) {
      if (isOverCap(packets.length, policy)) break;
      packets.push(packet);
      if (shouldFlush(packets.length, policy)) {
        // A monologue is cut here rather than held until the speaker stops:
        // hand off what we have and keep collecting into a fresh array.
        void deliver(guild, userId, packets.splice(0, packets.length));
      }
    }
  } finally {
    session.speakers.delete(userId);
    stream.destroy?.();
  }
  await deliver(guild, userId, packets);
}

/** Turn one capture into a line in the log. */
async function deliver(guild, userId, packets) {
  const session = sessions.get(guild.id);
  if (!session) return;
  const worth = isWorthTranscribing(packets);
  if (!worth.ok) return;

  const result = await transcribeBuffer(guild.id, encodeOggOpus(packets), {
    filename: `voice-${userId}.ogg`,
    contentType: 'audio/ogg',
  });
  if (!result.ok) {
    if (result.reason === 'failed') logger.warn(`Transcribe: voice chunk failed — ${result.detail}`);
    return;
  }

  const member = guild.members.cache.get(userId);
  const line = formatLine({
    name: member?.displayName ?? `<@${userId}>`,
    text: result.text,
    at: Date.now(),
    timestamps: getTranscribeConfig(guild.id).voiceTimestamps,
  });
  session.buffer.add(line, Date.now());
}

/** Post whatever is buffered, if it is time. */
async function flush(guildId) {
  const session = sessions.get(guildId);
  if (!session || !session.buffer.shouldFlush(Date.now())) return;
  await flushNow(session);
}

async function flushNow(session) {
  const lines = session.buffer.drain();
  if (lines.length === 0) return;
  for (const post of packLines(lines)) {
    await session.textChannel
      .send({ content: post, allowedMentions: { parse: [] } })
      .catch((error) => logger.warn('Transcribe: could not post a voice transcript:', error));
  }
}

/** Whether the bot is already in a voice channel in this guild (any reason). */
export const existingConnection = (guildId) => getVoiceConnection(guildId) ?? null;
