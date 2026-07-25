import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { CROOKS } from '../lib/hunt.js';
import {
  getHuntingConfig,
  huntingAvailable,
  nextSpawnInfo,
  setHuntingConfig,
  spawnCrook,
} from '../service.js';
import { formatWaitMs } from '../../economy/lib/bank.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hunting')
    .setDescription('The crook hunt: channels, timing, catch mode, rewards (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Master switch for the hunt'))
    .addChannelOption((o) =>
      o
        .setName('add-channel')
        .setDescription('Start hunting in this channel')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addChannelOption((o) =>
      o
        .setName('remove-channel')
        .setDescription('Stop hunting in this channel')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('How crooks are caught')
        .addChoices(
          { name: 'words — shout STOP POLICE', value: 'words' },
          { name: 'reaction — press 🚨', value: 'reaction' },
        ),
    )
    .addBooleanOption((o) => o.setName('show-time').setDescription('Show the response time on catches'))
    .addBooleanOption((o) =>
      o.setName('undercover').setDescription('The undercover-officer special (salute, don’t cuff)'),
    )
    .addIntegerOption((o) =>
      o.setName('reward-min').setDescription('Minimum donuts per catch').setMinValue(0).setMaxValue(100000),
    )
    .addIntegerOption((o) =>
      o.setName('reward-max').setDescription('Maximum donuts per catch').setMinValue(0).setMaxValue(100000),
    )
    .addIntegerOption((o) =>
      o.setName('interval-min').setDescription('Minimum seconds between crooks (≥60)').setMinValue(60).setMaxValue(86400),
    )
    .addIntegerOption((o) =>
      o.setName('interval-max').setDescription('Maximum seconds between crooks (≥120)').setMinValue(120).setMaxValue(86400),
    )
    .addIntegerOption((o) =>
      o.setName('timeout').setDescription('Seconds before the crook escapes (≥10)').setMinValue(10).setMaxValue(600),
    )
    .addChannelOption((o) =>
      o
        .setName('test-spawn')
        .setDescription('Spawn one crook RIGHT NOW in this channel (test)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const guildId = interaction.guild.id;
    const notes = [];

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    if (enabled !== null) patch.enabled = enabled;
    const mode = interaction.options.getString('mode');
    if (mode) patch.mode = mode;
    const showTime = interaction.options.getBoolean('show-time');
    if (showTime !== null) patch.showTime = showTime;
    const undercover = interaction.options.getBoolean('undercover');
    if (undercover !== null) patch.undercover = undercover;
    for (const [opt, key] of [
      ['reward-min', 'rewardMin'],
      ['reward-max', 'rewardMax'],
      ['interval-min', 'intervalMinS'],
      ['interval-max', 'intervalMaxS'],
      ['timeout', 'catchTimeoutS'],
    ]) {
      const value = interaction.options.getInteger(opt);
      if (value !== null) patch[key] = value;
    }

    const current = getHuntingConfig(guildId);
    const addChannel = interaction.options.getChannel('add-channel');
    if (addChannel) {
      patch.channels = current.channels.includes(addChannel.id)
        ? current.channels
        : [...current.channels, addChannel.id];
      notes.push(
        current.channels.includes(addChannel.id)
          ? `ℹ️ Already hunting in <#${addChannel.id}>.`
          : `✅ The hunt is on in <#${addChannel.id}>.`,
      );
    }
    const removeChannel = interaction.options.getChannel('remove-channel');
    if (removeChannel) {
      const base = patch.channels ?? current.channels;
      patch.channels = base.filter((id) => id !== removeChannel.id);
      notes.push(`🛑 Hunt stopped in <#${removeChannel.id}>.`);
    }
    const config = Object.keys(patch).length ? setHuntingConfig(guildId, patch) : current;

    const testChannel = interaction.options.getChannel('test-spawn');
    if (testChannel) {
      const target = interaction.guild.channels.cache.get(testChannel.id);
      const spawned = target ? await spawnCrook(target, {}) : null;
      notes.push(
        spawned
          ? `🧪 A crook just appeared in <#${testChannel.id}> — go get them!`
          : '⚠️ Test spawn failed (no send access, or a hunt is already open there).',
      );
    }

    const wait = nextSpawnInfo(guildId);
    const intentLine = huntingAvailable(interaction.client, config)
      ? config.mode === 'words'
        ? '✅ Words mode — STOP POLICE shouts are heard.'
        : '✅ Reaction mode — 🚨 presses count (works without Message Content).'
      : '⚠️ **Words mode needs the Message Content intent** — no crooks will spawn. Switch `mode:` to reaction, or enable the intent.';

    const embed = new EmbedBuilder()
      .setColor(0x1f8b4c)
      .setTitle('🦹 The Crook Hunt')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Hunting in:** ${config.channels.length ? config.channels.map((id) => `<#${id}>`).join(' ') : '_no channels — add one with `add-channel:`_'}`,
          `**Between crooks:** ${Math.round(config.intervalMinS / 60)}–${Math.round(config.intervalMaxS / 60)} min · **escape after:** ${config.catchTimeoutS} s`,
          `**Catch:** ${config.mode === 'words' ? 'shout **STOP POLICE**' : 'press 🚨'} · **bounty:** ${config.rewardMin}–${config.rewardMax} 🍩`,
          `**Undercover officer:** ${config.undercover ? 'on the beat — salute 🫡, don’t cuff' : 'off'} · **response time:** ${config.showTime ? 'shown' : 'hidden'}`,
          `**Next crook:** ${wait === null ? 'the clock arms on the next message in a hunt channel' : wait === 0 ? 'any moment now' : `~${formatWaitMs(wait)}`}`,
          '',
          `**Wanted board:** ${CROOKS.map((c) => c.emoji).join(' ')}`,
          intentLine,
          ...(notes.length ? ['', ...notes] : []),
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } });
  },
};
