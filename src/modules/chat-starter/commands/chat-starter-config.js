import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { getStarterConfig, nextQuestion, postStarter, questionBank, setStarterConfig } from '../service.js';
import { pickProvider } from '../../detective/lib/providers.js';

export const TEST_DELAY_MS = 30_000;

export default {
  data: new SlashCommandBuilder()
    .setName('chat-starter-config')
    .setDescription('View or change the chat starter (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the chat starter on/off (off by default)'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to revive when it goes quiet')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addIntegerOption((o) =>
      o
        .setName('idle-minutes')
        .setDescription('Minutes of silence before a starter (15–1440, default 720 = 12 h)')
        .setMinValue(15)
        .setMaxValue(1440),
    )
    .addBooleanOption((o) =>
      o.setName('use-ai').setDescription('Generate questions via the detective (falls back to the list)'),
    )
    .addBooleanOption((o) => o.setName('preview').setDescription('Show a sample question (nothing is posted)'))
    .addBooleanOption((o) =>
      o.setName('test').setDescription('Post a REAL starter in the configured channel in ~30 seconds'),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    const idleMinutes = interaction.options.getInteger('idle-minutes');
    const useAi = interaction.options.getBoolean('use-ai');
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    if (idleMinutes !== null) patch.idleMinutes = idleMinutes;
    if (useAi !== null) patch.useAi = useAi;
    const config = Object.keys(patch).length
      ? setStarterConfig(interaction.guild.id, patch)
      : getStarterConfig(interaction.guild.id);

    const preview = interaction.options.getBoolean('preview') === true;
    let sampleLine = '';
    if (preview) {
      await interaction.deferReply({ flags: 64 });
      const sample = await nextQuestion(interaction.guild.id, config);
      sampleLine = `\n**Sample:** ${sample ?? '_question bank unavailable_'}`;
    }

    // Test shot (owner request S30): arm ONE real starter ~30 s from now in
    // the configured channel — idle window and monologue guard bypassed, so
    // the owner can see the real thing without waiting 12 hours.
    const testShot = interaction.options.getBoolean('test') === true;
    let testLine = '';
    if (testShot) {
      if (!config.channelId) {
        testLine = '\n⚠️ **Test:** no channel configured — nothing to arm.';
      } else {
        const guild = interaction.guild;
        const timer = setTimeout(() => {
          postStarter(guild, getStarterConfig(guild.id)).catch(() => {});
        }, TEST_DELAY_MS);
        timer.unref?.();
        testLine = `\n🧪 **Test armed:** a real starter hits <#${config.channelId}> in ~${Math.round(TEST_DELAY_MS / 1000)} seconds.`;
      }
    }

    const aiReady = Boolean(pickProvider(process.env));
    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('💬 Chat Starter')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no (off by default)'}`,
          `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set'}`,
          `**Idle threshold:** ${config.idleMinutes} minutes of silence`,
          `**Question source:** ${config.useAi ? (aiReady ? 'AI (detective provider), list fallback' : '⚠️ AI requested but no provider key — using the list') : `list (${questionBank().length} questions)`}`,
          '',
          '_After a starter, the next one waits for a human reply first — the bot never monologues._' + sampleLine + testLine,
        ].join('\n'),
      );
    if (preview) await interaction.editReply({ embeds: [embed] });
    else await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
