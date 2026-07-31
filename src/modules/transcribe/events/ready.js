// The boot sweep (S136): reconcile what Discord SHOWS with what this process
// KNOWS, once, at startup.
//
// The bot restarts itself on every self-update (S127), and the live session
// map is RAM-only — so until this file existed, every merged PR silently
// killed a running transcription. Discord kept showing the bot in the voice
// channel; the fresh process had no session; and auto-join never fired again
// because it only reacts to a human ENTERING a channel. Owner report:
// "Waarom werkt de transcribe niet, de bot is wel in het kanaal."
//
// The decision is pure (`resumePlan` in ../lib/pairing.js); this file is the
// plumbing that reads Discord's state and carries the decision out.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { hasAudioKey } from '../lib/audio-provider.js';
import { humansIn, resumePlan } from '../lib/pairing.js';
import { getTranscribeConfig } from '../service.js';
import { canWork, transcriptChannelFor } from './voice-state.js';
import { isListening, startListening } from '../voice/session.js';

/**
 * Sweep one guild. Exported with injectable seams so the decision-to-action
 * wiring is testable without a gateway (the schedulers' pattern, S87).
 */
export async function resumeSweep(guild, { start = startListening, key = hasAudioKey } = {}) {
  if (isListening(guild.id)) return { action: 'none', reason: 'already-listening' };
  const config = getTranscribeConfig(guild.id);

  const me = guild.members?.me ?? null;
  const lingerChannel = me?.voice?.channel ?? null;
  const voiceChannels = [...(guild.channels?.cache?.values() ?? [])].filter((c) => c?.isVoiceBased?.());

  const plan = resumePlan({
    lingering: lingerChannel ? { channelId: lingerChannel.id, humans: humansIn(lingerChannel) } : null,
    channels: voiceChannels.map((c) => ({ id: c.id, humans: humansIn(c) })),
    config,
    hasKey: key(process.env),
  });

  if (plan.action === 'disconnect') {
    // A bot that sits in a channel and writes nothing is a false promise —
    // leaving visibly is the honest state.
    await me?.voice?.disconnect?.().catch(() => null);
    logger.info(`Transcribe: left a stale voice state in ${plan.channelId} at boot.`);
    return plan;
  }
  if (plan.action !== 'resume' && plan.action !== 'join') return plan;

  const channel = guild.channels.cache.get(plan.channelId);
  if (!channel) return { action: 'none', reason: 'channel-gone' };
  const target = transcriptChannelFor(guild, channel, config);
  if (!target || !canWork(guild, channel, target.channel)) {
    await me?.voice?.disconnect?.().catch(() => null);
    return { action: 'none', reason: 'cannot-work' };
  }

  const result = await start(guild, channel, target.channel);
  if (!result.ok) return { action: 'none', reason: result.reason };

  // Same announcement duty as auto-join (S110): the bot let itself (back) in,
  // so the people in earshot are told, unprompted.
  await target.channel
    .send({
      content:
        `🔴 **Recording ${channel}.** I restarted for an update and picked the session back up — ` +
        `everything said there is transcribed here.\n\`!transcribe leave\` stops it.`,
      allowedMentions: { parse: [] },
    })
    .catch(() => null);
  return plan;
}

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    for (const guild of client.guilds.cache.values()) {
      await resumeSweep(guild).catch((error) =>
        logger.warn(`Transcribe: boot voice sweep failed for ${guild.id}:`, error),
      );
    }
  },
};
