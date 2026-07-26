// The !transcribe group (S101 = M21.1, owner request). Reading a transcript is
// public; every knob is Manage Server.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { hasAudioKey } from '../lib/audio-provider.js';
import { audioAttachmentsOf, refusalFor } from '../lib/transcribe.js';
import { getBudget, getTranscribeConfig, setTranscribeConfig, transcribeMessage } from '../service.js';

/**
 * Find the recording the member means: the message they replied to, else the
 * most recent message with audio in this channel. Replying is the precise way
 * and the one the manual teaches; the scan is what makes "…what did that say?"
 * work without scrolling up to copy an id.
 */
async function findRecording(ctx) {
  const ref = ctx.message.reference?.messageId;
  if (ref) {
    try {
      const target = await ctx.channel.messages.fetch(ref);
      if (target) return target;
    } catch {
      return null;
    }
  }
  try {
    const recent = await ctx.channel.messages.fetch({ limit: 25 });
    return [...recent.values()].find((m) => audioAttachmentsOf(m).length > 0) ?? null;
  } catch {
    return null;
  }
}

export default {
  group: {
    name: 'transcribe',
    aliases: ['stt', 'statement'],
    description: 'Turn voice memos into written statements, in English.',
    emoji: '🎙️',
    async status(ctx) {
      const config = getTranscribeConfig(ctx.guild.id);
      const budget = getBudget(ctx.guild.id);
      const today = new Date().toISOString().slice(0, 10);
      const used = budget.day === today ? budget.used : 0;
      return [
        `**Enabled:** ${config.enabled ? '🟢 yes' : '🔴 no'}`,
        `**Service:** ${hasAudioKey(process.env) ? '🟢 Groq / Whisper' : '⚠️ none — the owner must add `GROQ_API_KEY` to `.env` and restart'}`,
        `**Output:** ${config.translateToEnglish ? 'always English' : 'the language that was spoken'}`,
        `**Automatic:** voice messages ${config.autoVoiceMessages ? '✅' : '❌'} · audio files ${config.autoAudioFiles ? '✅' : '❌'}`,
        `**Channels:** ${
          config.channelIds.length === 0
            ? 'everywhere'
            : config.channelIds.map((id) => `<#${id}>`).join(', ')
        }`,
        `**Today:** ${used}${config.dailyLimit > 0 ? ` / ${config.dailyLimit}` : ''} transcribed`,
        '',
        `Reply to a recording and run \`${ctx.prefix}transcribe now\` to transcribe it on demand.`,
      ];
    },
    subcommands: [
      {
        name: 'now',
        aliases: ['this', 'it'],
        description: 'Transcribe the recording you replied to (or the last one posted here).',
        args: [],
        async run(ctx) {
          const target = await findRecording(ctx);
          if (!target) {
            await ctx.reply(
              '🎙️ No recording found. Reply to the message with the audio and try again.',
            );
            return;
          }
          await ctx.typing();
          const result = await transcribeMessage(ctx.guild.id, target, { manual: true });
          if (!result.ok) {
            await ctx.reply(
              result.reason === 'failed'
                ? `🎙️ The transcription desk could not read that recording. (${result.detail})`
                : `🎙️ ${refusalFor(result.reason)}`,
            );
            return;
          }
          await ctx.reply({
            embeds: [new EmbedBuilder(result.embed)],
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'on',
        description: 'Start transcribing voice memos automatically.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          setTranscribeConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('🎙️ The transcription desk is open.');
        },
      },
      {
        name: 'off',
        description: 'Stop transcribing automatically (the command still works).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          setTranscribeConfig(ctx.guild.id, { enabled: false });
          await ctx.reply(
            `🎙️ Automatic transcription is off. \`${ctx.prefix}transcribe now\` still works on request.`,
          );
        },
      },
      {
        name: 'auto',
        description: 'Which attachments are transcribed without being asked.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'kind', type: 'string', required: true, choices: ['voice', 'files'] },
          { name: 'state', type: 'boolean', required: true },
        ],
        async run(ctx, { kind, state }) {
          const key = kind === 'voice' ? 'autoVoiceMessages' : 'autoAudioFiles';
          setTranscribeConfig(ctx.guild.id, { [key]: state });
          const what = kind === 'voice' ? 'Voice messages' : 'Attached audio files';
          await ctx.reply(
            `🎙️ ${what} are ${state ? 'now' : 'no longer'} transcribed automatically.`,
          );
        },
      },
      {
        name: 'english',
        description: 'Always translate to English, or keep the spoken language.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setTranscribeConfig(ctx.guild.id, { translateToEnglish: state });
          await ctx.reply(
            state
              ? '🎙️ Statements are written in **English**, whatever was spoken.'
              : '🎙️ Statements are written in the **language that was spoken**.',
          );
        },
      },
      {
        name: 'channel',
        description: 'Transcribe only in these channels — run it per channel to add.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'channel', type: 'channel', required: true }],
        async run(ctx, { channel }) {
          const set = new Set(getTranscribeConfig(ctx.guild.id).channelIds);
          const removed = set.delete(channel.id);
          if (!removed) set.add(channel.id);
          const next = setTranscribeConfig(ctx.guild.id, { channelIds: [...set] });
          await ctx.reply({
            content: removed
              ? `🎙️ ${channel} is no longer covered.${next.channelIds.length === 0 ? ' The list is empty, so the desk covers **every** channel again.' : ''}`
              : `🎙️ ${channel} added — the desk now covers **only** ${next.channelIds.map((id) => `<#${id}>`).join(', ')}.`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'everywhere',
        description: 'Cover every channel again (clears the channel list).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          setTranscribeConfig(ctx.guild.id, { channelIds: [] });
          await ctx.reply('🎙️ The desk covers **every** channel again.');
        },
      },
      {
        name: 'limit',
        description: 'Longest recording to transcribe, and how many per day.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'what', type: 'string', required: true, choices: ['duration', 'daily'] },
          { name: 'value', type: 'integer', required: true, min: 0, max: 10_000 },
        ],
        async run(ctx, { what, value }) {
          if (what === 'duration') {
            setTranscribeConfig(ctx.guild.id, { maxDurationSecs: value });
            await ctx.reply(
              value === 0
                ? '🎙️ Recordings of any length are accepted.'
                : `🎙️ Recordings longer than **${value} s** are skipped.`,
            );
            return;
          }
          setTranscribeConfig(ctx.guild.id, { dailyLimit: value });
          await ctx.reply(
            value === 0
              ? '🎙️ No daily transcription limit.'
              : `🎙️ At most **${value}** transcriptions per day.`,
          );
        },
      },
    ],
  },
};
