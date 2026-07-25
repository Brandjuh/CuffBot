// Shared enforcement checks that talk to Discord objects (so they live at the
// module root, not lib/). Every guard replies itself when it blocks, with a
// specific in-theme but factual message — a silent refusal reads as a broken
// bot.
//
// S93/S94: these are called from BOTH command shapes during the M17.3
// conversion — a flat command's `ctx` and a legacy adapter-built
// `interaction`. Both carry `guild`, `user`, `client` and `reply()`, so the
// guards work on either; the only difference is the ephemeral flag, which
// only means anything on the legacy path. `prefix` is the discriminator: the
// framework's ctx always has one, an interaction never does.
import { replyEither as refuse } from '../../core/prefix/context.js';

/**
 * Runtime permission check for the invoking member. The builder-level
 * default_member_permissions only controls visibility and can be overridden
 * by server admins — this is the check that counts.
 *
 * Flat and group commands do NOT need this: their `permission` field is
 * enforced by the framework before run() is entered, and its refusal names
 * the permission correctly (S93). It stays for the commands M17.3 has not
 * converted yet.
 *
 * @returns {Promise<boolean>} true when allowed; false after replying
 */
export async function ensureInvokerPermission(interaction, flag, actionLabel) {
  if (interaction.memberPermissions?.has(flag)) return true;
  await refuse(interaction, `🚫 Not your jurisdiction: you lack the **${actionLabel}** permission.`);
  return false;
}

/**
 * Refuse self-targeting and bot-targeting with fitting replies.
 * @returns {Promise<boolean>} true when the target is actionable
 */
export async function ensureSensibleTarget(source, targetUser) {
  if (targetUser.id === source.user.id) {
    await refuse(
      source,
      '🚫 You cannot take enforcement action against yourself. Internal Affairs has been notified. (Not really.)',
    );
    return false;
  }
  if (targetUser.id === source.client.user.id) {
    await refuse(source, "🚫 You can't cuff the police. CuffBot is un-arrestable.");
    return false;
  }
  return true;
}

/**
 * Fetch the target as a guild member, or null when they are not in the guild
 * (which is a valid situation for bans/unbans by id).
 */
export async function fetchMember(source, userId) {
  return source.guild.members.fetch(userId).catch(() => null);
}

/** Standard reply when role hierarchy blocks the bot. */
export async function replyHierarchyBlocked(source, targetUser) {
  await refuse(
    source,
    `🚫 Cannot act on ${targetUser}: their highest role is at or above mine (or they are the server owner). Move the CuffBot role higher in Server Settings → Roles.`,
  );
}
