// The !transcribe group (S101 = M21.1, owner request). Reading a transcript is
// public; every knob is Manage Server.
import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { hasAudioKey } from '../lib/audio-provider.js';
import { audioAttachmentsOf, formatDuration, refusalFor } from '../lib/transcribe.js';
import { DEFAULT_VOICE_PAIRS, HOW_LABEL, autoJoinDiagnosis, describePairings } from '../lib/pairing.js';
import { getBudget, getTranscribeConfig, setTranscribeConfig, transcribeMessage } from '../service.js';
import { isListening, sessionFor, startListening, stopListening } from '../voice/session.js';

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
        // S121, owner: "ik zie dat de rate limit 100 is, is dat 100 minuten?
        // 100 seconden? 100 berichten?" — a bare number next to a slash is a
        // unit-less quantity, and the reset window was nowhere at all.
        `**Today:** ${used} / ${config.dailyLimit > 0 ? `${config.dailyLimit} transcriptions` : '∞'}${
          config.dailyLimit > 0 ? ' · resets at midnight UTC' : ''
        }`,
        `**Longest recording:** ${
          config.maxDurationSecs > 0 ? `${formatDuration(config.maxDurationSecs)} — longer ones are skipped` : 'no limit'
        }`,
        `**Live voice:** ${
          isListening(ctx.guild.id)
            ? `🔴 recording <#${sessionFor(ctx.guild.id).channelId}>`
            : `not in a voice channel — \`${ctx.prefix}transcribe join\``
        }`,
        // S117: the owner reported auto-join not working and had no way to see
        // why — every refusal in the handler is a silent return. Now the same
        // conditions are one command away.
        (() => {
          const d = autoJoinDiagnosis(config, {
            hasKey: hasAudioKey(process.env),
            inVoice: isListening(ctx.guild.id),
          });
          return `**Auto-join:** ${d.ok ? '🟢' : '⚪'} ${d.detail}`;
        })(),
        `**Skipping:** other bots ${config.ignoreBots === false ? '❌ (music IS transcribed)' : '✅ (music is ignored)'}${
          config.ignoredUserIds?.length ? ` · ${config.ignoredUserIds.map((id) => `<@${id}>`).join(', ')}` : ''
        }`,
        `**Auto-join:** ${
          config.autoJoin
            ? `🟢 on — ${
                config.voiceChannelIds.length === 0
                  ? 'any voice channel'
                  : config.voiceChannelIds.map((id) => `<#${id}>`).join(', ')
              }`
            : '🔴 off'
        }`,
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
        name: 'join',
        aliases: ['listen'],
        description: 'Join your voice channel and write down what is said.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          const voiceChannel = ctx.member?.voice?.channel;
          if (!voiceChannel) {
            await ctx.reply('🎙️ Join a voice channel first, then run this there.');
            return;
          }
          if (isListening(ctx.guild.id)) {
            await ctx.reply(
              `🎙️ Already recording <#${sessionFor(ctx.guild.id).channelId}>. \`${ctx.prefix}transcribe leave\` first.`,
            );
            return;
          }
          if (!hasAudioKey(process.env)) {
            await ctx.reply(`🎙️ ${refusalFor('no-key')}`);
            return;
          }
          const me = ctx.guild.members.me;
          const allowed = voiceChannel.permissionsFor?.(me);
          if (allowed && !allowed.has(PermissionFlagsBits.Connect)) {
            await ctx.reply(`🎙️ I am not allowed to connect to ${voiceChannel}.`);
            return;
          }

          await ctx.typing();
          const result = await startListening(ctx.guild, voiceChannel, ctx.channel);
          if (!result.ok) {
            await ctx.reply(
              result.reason === 'join-failed'
                ? '🎙️ I could not connect to that voice channel.'
                : '🎙️ I am already listening somewhere.',
            );
            return;
          }
          // Say it out loud, in the channel, unprompted: the bot is recording
          // people, and everyone within earshot is entitled to know that
          // without having to run a command to find out.
          await ctx.reply({
            content: `🔴 **Recording ${voiceChannel}.** Everything said there will be transcribed into this channel${
              getTranscribeConfig(ctx.guild.id).translateToEnglish ? ' in English' : ''
            }. \`${ctx.prefix}transcribe leave\` stops it.`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'leave',
        aliases: ['stop'],
        description: 'Leave the voice channel and stop transcribing it.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          if (!stopListening(ctx.guild.id)) {
            await ctx.reply('🎙️ I am not in a voice channel here.');
            return;
          }
          await ctx.reply('🎙️ Left the channel. Recording stopped.');
        },
      },
      {
        name: 'autojoin',
        aliases: ['follow'],
        description: 'Join a voice channel by myself when somebody is in it.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setTranscribeConfig(ctx.guild.id, { autoJoin: state });
          await ctx.reply(
            state
              ? '🎙️ I will join a voice channel on my own and write into the text channel with the same name.'
              : `🎙️ I will stay out unless somebody runs \`${ctx.prefix}transcribe join\`.`,
          );
        },
      },
      {
        name: 'voicechannel',
        aliases: ['vc'],
        description: 'Auto-join only these voice channels — run it per channel to add.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'channel', type: 'channel', required: true }],
        async run(ctx, { channel }) {
          const set = new Set(getTranscribeConfig(ctx.guild.id).voiceChannelIds);
          const removed = set.delete(channel.id);
          if (!removed) set.add(channel.id);
          const next = setTranscribeConfig(ctx.guild.id, { voiceChannelIds: [...set] });
          await ctx.reply({
            content: removed
              ? `🎙️ ${channel} dropped.${next.voiceChannelIds.length === 0 ? ' The list is empty, so I auto-join **every** voice channel again.' : ''}`
              : `🎙️ ${channel} added — I now auto-join **only** ${next.voiceChannelIds.map((id) => `<#${id}>`).join(', ')}.`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'pair',
        description: 'Say which text channel goes with a voice channel.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'voice', type: 'channel', required: true },
          { name: 'text', type: 'channel', postable: true }, // omit to unpair
        ],
        async run(ctx, { voice, text }) {
          const pairs = { ...getTranscribeConfig(ctx.guild.id).voicePairs };
          if (!text) {
            // Unpairing restores the DEFAULT for that channel rather than
            // nothing — an explicit blank would be a third state nobody wants.
            delete pairs[voice.id];
            setTranscribeConfig(ctx.guild.id, { voicePairs: pairs });
            await ctx.reply({
              content: `🎙️ ${voice} is back to the built-in pairing (or the name match).`,
              allowedMentions: { parse: [] },
            });
            return;
          }
          pairs[voice.id] = text.id;
          setTranscribeConfig(ctx.guild.id, { voicePairs: pairs });
          await ctx.reply({
            content: `🎙️ ${voice} → ${text}. That beats any name match.`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'pairs',
        aliases: ['list', 'where'],
        description: 'Where every voice channel’s transcript goes, and why.',
        args: [],
        async run(ctx) {
          // S118: this used to list only the STORED pairings, which answers
          // "what is configured" and not "where does each channel write".
          // Most rooms are matched by name and appeared nowhere at all.
          const guildPairs = getTranscribeConfig(ctx.guild.id).voicePairs ?? {};
          const pairs = { ...DEFAULT_VOICE_PAIRS, ...guildPairs };
          const all = [...ctx.guild.channels.cache.values()];
          const voices = all
            .filter((c) => c?.type === ChannelType.GuildVoice || c?.type === ChannelType.GuildStageVoice)
            .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
          const texts = all
            .filter((c) => c?.type === ChannelType.GuildText)
            .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));

          const { rows, orphans } = describePairings(voices, texts, pairs, guildPairs);

          const lines = rows.map((r) => {
            const target = r.textId ? `<#${r.textId}>` : `🔊 ${r.voiceName}'s own chat`;
            const marks = [
              HOW_LABEL[r.how],
              r.overridden ? 'this server' : null,
              r.staleTarget ? `⚠️ paired to \`${r.staleTarget}\`, which no longer exists` : null,
            ].filter(Boolean);
            return `<#${r.voiceId}> → ${target}\n-# ${marks.join(' · ')}`;
          });

          if (orphans.length) {
            lines.push(
              `\n⚠️ **Pairings for voice channels that no longer exist** — \`${ctx.prefix}transcribe unpair <id>\` clears one:`,
              ...orphans.map((o) => `-# \`${o.voiceId}\` → <#${o.textId}>${o.fromDefault ? ' *(built-in default)*' : ''}`),
            );
          }

          await ctx.reply({
            content:
              rows.length === 0
                ? '🎙️ This server has no voice channels.'
                : `🎙️ **Where each voice channel writes**\n\n${lines.join('\n')}`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'unpair',
        description: 'Remove a voice → text pairing (accepts a deleted channel’s id too).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'voice', type: 'string', required: true }],
        async run(ctx, { voice }) {
          // A STRING, not a channel: a pairing whose voice channel has been
          // deleted is exactly the one you most want to remove, and a channel
          // arg cannot resolve a channel that is gone.
          const id = String(voice).match(/^<#(\d+)>$/)?.[1] ?? String(voice).match(/^(\d{15,21})$/)?.[1];
          if (!id) {
            await ctx.reply('🎙️ Give me a voice channel (#mention) or its raw id.');
            return;
          }

          const stored = { ...getTranscribeConfig(ctx.guild.id).voicePairs };
          const hadOverride = Object.hasOwn(stored, id);
          delete stored[id];
          setTranscribeConfig(ctx.guild.id, { voicePairs: stored });

          // Removing a guild override falls back to the committed default, so
          // saying "removed" without that caveat would be wrong for the four
          // pairings the owner gave in S111.
          const fallsBackTo = DEFAULT_VOICE_PAIRS[id];
          const where = fallsBackTo
            ? `back to its built-in pairing with <#${fallsBackTo}>`
            : 'back to matching by name';
          await ctx.reply({
            content: hadOverride
              ? `🎙️ Override removed — <#${id}> goes ${where}.`
              : fallsBackTo
                ? `🎙️ <#${id}> has no override to remove; it uses the built-in pairing with <#${fallsBackTo}>. Point it somewhere else with \`${ctx.prefix}transcribe pair\`.`
                : `🎙️ Nothing stored for \`${id}\` — it was already matched by name.`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'ignore',
        description: 'Never transcribe this member (music bots are already skipped).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'member', type: 'user', required: true }],
        async run(ctx, { member }) {
          const set = new Set(getTranscribeConfig(ctx.guild.id).ignoredUserIds);
          const removed = set.delete(member.id);
          if (!removed) set.add(member.id);
          setTranscribeConfig(ctx.guild.id, { ignoredUserIds: [...set] });
          await ctx.reply({
            content: removed
              ? `🎙️ ${member} is transcribed again.`
              : `🎙️ ${member} is never transcribed. Run it again to undo.`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'bots',
        description: 'Transcribe other bots too — off by default, which is what skips music.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setTranscribeConfig(ctx.guild.id, { ignoreBots: !state });
          await ctx.reply(
            state
              ? '🎙️ Other bots **are** transcribed now — a music bot in the channel will be written down as lyrics, and it spends the daily budget.'
              : '🎙️ Other bots are skipped. Music playing through a bot is ignored.',
          );
        },
      },
      {
        name: 'timestamps',
        description: 'Prefix each live-voice line with the time it was said.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setTranscribeConfig(ctx.guild.id, { voiceTimestamps: state });
          await ctx.reply(
            state
              ? '🎙️ Live transcript lines carry an `HH:MM` stamp (UTC).'
              : '🎙️ Live transcript lines are just **name:** and the words.',
          );
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
        description: 'Caps: `duration` in SECONDS per recording, `daily` a COUNT of transcriptions.',
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
                : `🎙️ Recordings longer than **${formatDuration(value)}** (${value} seconds) are skipped. Everything shorter is transcribed as usual.`,
            );
            return;
          }
          setTranscribeConfig(ctx.guild.id, { dailyLimit: value });
          await ctx.reply(
            value === 0
              ? '🎙️ No daily transcription limit.'
              : `🎙️ At most **${value} transcriptions per day** — not minutes, not messages: ${value} pieces of audio actually turned into text, counted across the whole server and reset at midnight UTC. Live voice spends from the same budget.`,
          );
        },
      },
    ],
  },
};
