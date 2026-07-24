// The self-roles button pump: one module-owned InteractionCreate handler
// (patrol-wizard pattern) that only touches "selfroles:" customIds. Every
// answer is ephemeral — role toggles are personal, the channel stays clean.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { BUTTON_PREFIX, toggleSelfRole } from '../service.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const customId = interaction.customId ?? '';
    if (!customId.startsWith(BUTTON_PREFIX)) return;
    try {
      const guild = interaction.guild;
      const member = interaction.member;
      if (!guild || !member) return;
      const roleId = customId.slice(BUTTON_PREFIX.length);
      const result = await toggleSelfRole(guild, member, roleId);
      const replies = {
        added: `✅ You now have **${result.roleName}**. Press the button again to take it off.`,
        removed: `🗑️ **${result.roleName}** removed.`,
        'not-selfrole': '⚠️ That role is not self-assignable (anymore) — the list is refreshing itself.',
        failed: `⚠️ Could not toggle **${result.roleName ?? 'that role'}** — my role probably sits below it. An admin can check the role order.`,
      };
      await interaction.reply({ content: replies[result.code], flags: 64, allowedMentions: { parse: [] } });
    } catch (error) {
      logger.warn('Self roles: button press failed:', error);
      try {
        await interaction.reply({ content: '⚠️ Something went wrong on my end — try again in a moment.', flags: 64 });
      } catch {
        /* interaction already answered or gone */
      }
    }
  },
};
