// Auto-join (S110, owner request: "Zodra iemand een VC joined wil ik dat de
// bot automatisch erbij gaat zitten. De voice en text kanalen hebben dezelfde
// naam dus je kunt meteen een transcribe maken in het juiste tekst kanaal").
//
// Somebody enters a voice channel → the bot follows and starts writing into
// the text channel with the matching name. Everybody leaves → the bot leaves.
//
// Every rule lives in ../lib/pairing.js; this file is the gateway plumbing
// that cannot exist without a guild.
import { ChannelType, Events, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { hasAudioKey } from '../lib/audio-provider.js';
import { humansIn, pairTextChannel, shouldAutoJoin, shouldAutoLeave } from '../lib/pairing.js';
import { getTranscribeConfig } from '../service.js';
import { isListening, sessionFor, startListening, stopListening } from '../voice/session.js';

/**
 * Where the transcript should go for this voice channel.
 *
 * The name match is the owner's own convention. When it finds nothing the
 * fallback is the voice channel's **own built-in text chat** — every Discord
 * voice channel has had one since 2022, it is always the right room by
 * construction, and it is never a guess. Posting into a wrongly-guessed
 * channel would put a private conversation somewhere it does not belong.
 */
export function transcriptChannelFor(guild, voiceChannel) {
  const texts = [...guild.channels.cache.values()].filter(
    (c) => c?.type === ChannelType.GuildText && c.id !== voiceChannel.id,
  );
  const paired = pairTextChannel(
    { id: voiceChannel.id, name: voiceChannel.name, parentId: voiceChannel.parentId },
    texts.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
  );
  if (paired) {
    const channel = guild.channels.cache.get(paired.id);
    if (channel) return { channel, how: paired.how };
  }
  // The voice channel itself is text-capable — the always-correct fallback.
  return voiceChannel.isTextBased?.() ? { channel: voiceChannel, how: 'built-in' } : null;
}

/** Can the bot actually do this here? Checked before joining, not after. */
function canWork(guild, voiceChannel, textChannel) {
  const me = guild.members.me;
  if (!me) return false;
  const voice = voiceChannel.permissionsFor?.(me);
  if (voice && !voice.has(PermissionFlagsBits.Connect)) return false;
  const text = textChannel.permissionsFor?.(me);
  if (text && !text.has(PermissionFlagsBits.SendMessages)) return false;
  return true;
}

export default {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const guild = newState?.guild ?? oldState?.guild;
    if (!guild) return;
    // The bot's own comings and goings must not trigger anything, or joining
    // would immediately re-trigger itself.
    if ((newState?.id ?? oldState?.id) === guild.client?.user?.id) return;

    try {
      await handleLeave(guild, oldState, newState);
      await handleJoin(guild, oldState, newState);
    } catch (error) {
      logger.warn('Transcribe: voice-state handling failed:', error);
    }
  },
};

/** Somebody arrived in a channel the bot is not already in. */
async function handleJoin(guild, oldState, newState) {
  const channel = newState?.channel;
  if (!channel || channel.id === oldState?.channelId) return;
  if (isListening(guild.id)) return; // one table at a time; already busy

  const config = getTranscribeConfig(guild.id);
  const verdict = shouldAutoJoin({ humans: humansIn(channel), channelId: channel.id }, config);
  if (!verdict.ok) return;
  // No key means no transcript, so joining would only make the bot appear in
  // the channel doing nothing. Stay out.
  if (!hasAudioKey(process.env)) return;

  const target = transcriptChannelFor(guild, channel);
  if (!target) {
    logger.warn(`Transcribe: no text channel found for voice channel ${channel.name}`);
    return;
  }
  if (!canWork(guild, channel, target.channel)) return;

  const result = await startListening(guild, channel, target.channel);
  if (!result.ok) return;

  // Everyone in earshot is told, unprompted — the bot let itself in, so the
  // announcement matters more here than it does for `!transcribe join`.
  await target.channel
    .send({
      content:
        `🔴 **Recording ${channel}.** I joined automatically; everything said there is transcribed here` +
        `${config.translateToEnglish ? ' in English' : ''}.\n` +
        `\`!transcribe leave\` stops it now · \`!transcribe autojoin false\` stops it for good.` +
        (target.how === 'built-in'
          ? '\n*(No text channel matches that name, so this is the voice channel’s own chat.)*'
          : ''),
      allowedMentions: { parse: [] },
    })
    .catch(() => null);
}

/** The last human left the channel the bot is sitting in. */
async function handleLeave(guild, oldState, newState) {
  const left = oldState?.channel;
  if (!left || left.id === newState?.channelId) return;
  const session = sessionFor(guild.id);
  if (!session || session.channelId !== left.id) return;
  if (!shouldAutoLeave(humansIn(left))) return;

  // Sitting alone in an empty channel would transcribe silence forever and
  // keep the Pi's CPU warm for nothing.
  stopListening(guild.id);
  await session.textChannel
    ?.send({ content: '⚪ Everyone left, so I did too. Recording stopped.' })
    .catch(() => null);
}
