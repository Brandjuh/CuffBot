import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { BIRTHDAY_BONUS, getEconomyConfig, setEconomyConfig, spawnHunt } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('economy-config')
    .setDescription('View or change the donut economy (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Master switch for the whole economy'))
    .addBooleanOption((o) => o.setName('hunt').setDescription('Crook hunts on/off'))
    .addIntegerOption((o) =>
      o
        .setName('earn')
        .setDescription('Donuts per active message (default 5)')
        .setMinValue(0)
        .setMaxValue(100),
    )
    .addChannelOption((o) =>
      o
        .setName('test-hunt')
        .setDescription('Spawn one crook RIGHT NOW in this channel (test)')
        .addChannelTypes(ChannelType.GuildText),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const hunt = interaction.options.getBoolean('hunt');
    const earn = interaction.options.getInteger('earn');
    if (enabled !== null) patch.enabled = enabled;
    if (hunt !== null) patch.huntEnabled = hunt;
    if (earn !== null) patch.earnPerMessage = earn;
    const config = Object.keys(patch).length
      ? setEconomyConfig(interaction.guild.id, patch)
      : getEconomyConfig(interaction.guild.id);

    let testLine = '';
    const testChannel = interaction.options.getChannel('test-hunt');
    if (testChannel) {
      const target = interaction.guild.channels.cache.get(testChannel.id);
      const spawned = target ? await spawnHunt(target, {}) : false;
      testLine = spawned
        ? `\n🧪 **Test:** a crook just appeared in <#${testChannel.id}> — go shout STOP POLICE!`
        : '\n⚠️ **Test failed:** could not post there (permissions?), or a hunt is already open in that channel.';
    }

    // The hunt reads the shout — without Message Content it is unwinnable, so
    // spawning is disabled and this status says exactly why.
    const intentLine = interaction.client.messageContentAvailable
      ? '✅ Message Content intent active — STOP POLICE shouts are heard.'
      : '⚠️ **Message Content intent OFF** — hunts will NOT spawn (the bot can’t hear "STOP POLICE"). Enable it: Developer Portal → Bot → Privileged Gateway Intents, then `/restart`.';

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('🍩 Donut Economy')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Starting balance:** ${config.startingBalance.toLocaleString('en-US')} 🍩 (everyone starts here)`,
          `**Activity pay:** ${config.earnPerMessage} 🍩 per message (max once per ${Math.round(config.earnCooldownMs / 1000)} s)`,
          `**Birthday gift:** ${BIRTHDAY_BONUS.toLocaleString('en-US')} 🍩 (announced with the birthday message)`,
          '',
          `**Crook hunts:** ${config.huntEnabled ? 'on' : 'off'} — spawn chance ${(config.huntChance * 100).toFixed(1)}% per message in an active channel, every ${Math.round(config.huntCooldownMs / 60_000)} min per channel at most`,
          `**The crook flees after:** ${config.huntMinDurationMs / 1000}–${config.huntMaxDurationMs / 1000} s`,
          `**Catch bounty:** ${config.catchRewardMin}–${config.catchRewardMax} 🍩 · **Steal on escape:** ${config.stealMin}–${config.stealMax} 🍩`,
          '',
          intentLine + testLine,
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
