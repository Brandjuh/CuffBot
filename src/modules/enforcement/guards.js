// Shared enforcement checks that talk to Discord objects (so they live at the
// module root, not lib/). Every guard replies to the interaction itself when
// it blocks, with a specific in-theme but factual message — a silent refusal
// reads as a broken bot.
import { MessageFlags } from 'discord.js';

/**
 * Runtime permission check for the invoking member. The builder-level
 * default_member_permissions only controls visibility and can be overridden
 * by server admins — this is the check that counts.
 * @returns {Promise<boolean>} true when allowed; false after replying
 */
export async function ensureInvokerPermission(interaction, flag, actionLabel) {
  if (interaction.memberPermissions?.has(flag)) return true;
  await interaction.reply({
    content: `🚫 Not your jurisdiction: you lack the **${actionLabel}** permission.`,
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

/**
 * Refuse self-targeting and bot-targeting with fitting replies.
 * @returns {Promise<boolean>} true when the target is actionable
 */
export async function ensureSensibleTarget(interaction, targetUser) {
  if (targetUser.id === interaction.user.id) {
    await interaction.reply({
      content: '🚫 You cannot take enforcement action against yourself. Internal Affairs has been notified. (Not really.)',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (targetUser.id === interaction.client.user.id) {
    await interaction.reply({
      content: "🚫 You can't cuff the police. CuffBot is un-arrestable.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

/**
 * Fetch the target as a guild member, or null when they are not in the guild
 * (which is a valid situation for bans/unbans by id).
 */
export async function fetchMember(interaction, userId) {
  return interaction.guild.members.fetch(userId).catch(() => null);
}

/** Standard reply when role hierarchy blocks the bot. */
export async function replyHierarchyBlocked(interaction, targetUser) {
  await interaction.reply({
    content: `🚫 Cannot act on ${targetUser}: their highest role is at or above mine (or they are the server owner). Move the CuffBot role higher in Server Settings → Roles.`,
    flags: MessageFlags.Ephemeral,
  });
}
