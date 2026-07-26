// Diffing permission bitfields (S113, owner: "Er zijn wat permissies veranderd
// echter zijn deze niet gelogd").
//
// Until S113 the logbook watched `GuildRoleUpdate` and `ChannelUpdate` but
// only ever reported RENAMES — a channel's permission edits were discarded
// with the comment "topic/permission edits are noise". They are the opposite
// of noise: who may do what is the one change on a Discord server worth
// keeping a paper trail of, and it is the one change that leaves no trace
// anywhere else once the audit log ages out.
//
// Pure: takes bigints and plain objects, returns plain objects. discord.js is
// imported for the FLAG TABLE only — a frozen map of names to bits, which is
// static data, not an API call — so every rule below is testable without a
// guild.
import { PermissionsBitField } from 'discord.js';

/** Discord's permission flags as [name, bit] pairs, highest-value last. */
const FLAGS = Object.entries(PermissionsBitField.Flags);

/**
 * Human-readable names for a permission bitfield.
 *
 * Discord's own flag names are CamelCase identifiers (`ManageGuild`), which
 * read badly in a log line, so they are spaced out (`Manage Guild`). Bits that
 * no flag in this discord.js version knows about are dropped rather than
 * printed as numbers: a new permission Discord shipped after this build should
 * not turn a log entry into hexadecimal.
 */
export function permissionNames(bits) {
  const value = BigInt(bits ?? 0n);
  return FLAGS.filter(([, bit]) => (value & bit) === bit && bit !== 0n).map(([name]) =>
    name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
  );
}

/**
 * What changed between two permission bitfields.
 *
 * @returns {{ added: string[], removed: string[], changed: boolean }}
 */
export function diffPermissions(before, after) {
  const a = BigInt(before ?? 0n);
  const b = BigInt(after ?? 0n);
  return {
    added: permissionNames(b & ~a),
    removed: permissionNames(a & ~b),
    changed: a !== b,
  };
}

/**
 * What changed between two sets of channel permission overwrites.
 *
 * An overwrite is `{ id, type, allow, deny }` where `type` is 0 for a role and
 * 1 for a member. Three things can happen to one, and they are reported
 * separately because they mean different things to whoever reads the log:
 * an overwrite can be **added** (a role gains an exception in this channel),
 * **removed** (it falls back to the server-wide permission — easy to miss, and
 * the usual way a channel silently opens up), or **edited**.
 *
 * An edit is diffed on both sides: allow and deny are independent bitfields, so
 * moving a permission from allow to deny is *two* changes, and reporting only
 * one of them would describe a lockdown as an unlock.
 *
 * @param {Array<{id:string,type:number,allow:bigint|string,deny:bigint|string}>} before
 * @param {Array<{id:string,type:number,allow:bigint|string,deny:bigint|string}>} after
 * @returns {Array<{id:string,type:number,action:'added'|'removed'|'edited',
 *   allow:{added:string[],removed:string[]}, deny:{added:string[],removed:string[]}}>}
 */
export function diffOverwrites(before = [], after = []) {
  const byId = (list) => new Map((list ?? []).filter((o) => o?.id).map((o) => [o.id, o]));
  const a = byId(before);
  const b = byId(after);
  const changes = [];

  for (const [id, next] of b) {
    const prev = a.get(id);
    if (!prev) {
      // A brand-new overwrite: everything it grants or denies is new, so it is
      // diffed against nothing rather than reported as a bare "added".
      const allow = diffPermissions(0n, next.allow);
      const deny = diffPermissions(0n, next.deny);
      if (allow.changed || deny.changed) {
        changes.push({ id, type: next.type, action: 'added', allow, deny });
      }
      continue;
    }
    const allow = diffPermissions(prev.allow, next.allow);
    const deny = diffPermissions(prev.deny, next.deny);
    if (allow.changed || deny.changed) {
      changes.push({ id, type: next.type, action: 'edited', allow, deny });
    }
  }

  for (const [id, prev] of a) {
    if (b.has(id)) continue;
    // Removal is reported as losing whatever it used to hold — "the @Officers
    // exception is gone" is useless without knowing what the exception was.
    changes.push({
      id,
      type: prev.type,
      action: 'removed',
      allow: { added: [], removed: permissionNames(prev.allow), changed: true },
      deny: { added: [], removed: permissionNames(prev.deny), changed: true },
    });
  }

  return changes;
}

/**
 * Render one overwrite change as log lines.
 *
 * The target is printed as a mention so the log is readable at a glance;
 * `type` decides which kind, and an unknown type falls back to the raw id
 * rather than guessing wrong and mentioning some unrelated role.
 */
export function describeOverwrite(change) {
  const target = change.type === 1 ? `<@${change.id}>` : change.type === 0 ? `<@&${change.id}>` : `\`${change.id}\``;
  const verb = { added: 'exception added', removed: 'exception removed', edited: 'exception edited' }[change.action];
  const parts = [];
  if (change.allow.added.length) parts.push(`✅ allow +${change.allow.added.join(', ')}`);
  if (change.allow.removed.length) parts.push(`✅ allow −${change.allow.removed.join(', ')}`);
  if (change.deny.added.length) parts.push(`⛔ deny +${change.deny.added.join(', ')}`);
  if (change.deny.removed.length) parts.push(`⛔ deny −${change.deny.removed.join(', ')}`);
  return `${target} — ${verb}\n${parts.map((p) => `　${p}`).join('\n')}`;
}

/** Plain `{id,type,allow,deny}` objects from a discord.js overwrite cache. */
export function overwriteSnapshot(channel) {
  const cache = channel?.permissionOverwrites?.cache;
  if (!cache) return [];
  return [...cache.values()].map((o) => ({
    id: o.id,
    type: o.type,
    allow: o.allow?.bitfield ?? 0n,
    deny: o.deny?.bitfield ?? 0n,
  }));
}
