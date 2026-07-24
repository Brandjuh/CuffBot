// Pure self-roles logic — no discord.js, no store. The self-assignable roles
// are read from the guild's own role list: everything positioned under the
// "self-roles" header role (S59 owner request), using the same section rules
// as the academy ladder (skip @everyone/managed, stop at the next divider).
// Roles arrive as plain objects; the service precomputes `elevated` because
// permission bitfields are a discord.js concern.
import { isSectionDivider } from '../../academy/lib/ladder.js';

export const DEFAULT_HEADER_NAME = 'self-roles';
export const MAX_SELF_ROLES = 25; // Discord: 5 buttons × 5 rows per message

/** Does this role name mark the self-roles section header? */
export function isSelfRolesHeader(name, headerName = DEFAULT_HEADER_NAME) {
  return (
    typeof name === 'string' &&
    name.trim().replace(/^[\s\W]+|[\s\W]+$/g, '').toLowerCase() ===
      String(headerName).toLowerCase()
  );
}

/**
 * Select the self-assignable roles from the guild's role list.
 * @param {Array<{id:string,name:string,managed?:boolean,elevated?:boolean}>} rolesDesc
 *   all roles ordered highest position first (the service builds this).
 * @returns {{headerFound:boolean, headerRoleId:string|null,
 *   roles:Array<{id:string,name:string}>, skipped:Array<{id:string,name:string,reason:string}>}}
 */
export function selectSelfRoles(rolesDesc, { headerName = DEFAULT_HEADER_NAME, cap = MAX_SELF_ROLES } = {}) {
  const headerIdx = (rolesDesc ?? []).findIndex((r) => isSelfRolesHeader(r.name, headerName));
  if (headerIdx < 0) return { headerFound: false, headerRoleId: null, roles: [], skipped: [] };

  const roles = [];
  const skipped = [];
  for (let i = headerIdx + 1; i < rolesDesc.length; i += 1) {
    const role = rolesDesc[i];
    if (role.name === '@everyone') continue;
    if (isSectionDivider(role.name)) break; // next section of the role list
    if (role.managed) {
      skipped.push({ id: role.id, name: role.name, reason: 'managed by an integration' });
      continue;
    }
    if (role.elevated) {
      // A self-assignable moderator role is a security hole, not a feature.
      skipped.push({ id: role.id, name: role.name, reason: 'has elevated permissions' });
      continue;
    }
    if (roles.length >= cap) {
      skipped.push({ id: role.id, name: role.name, reason: `over the ${cap}-button limit` });
      continue;
    }
    roles.push({ id: role.id, name: role.name });
  }
  return { headerFound: true, headerRoleId: rolesDesc[headerIdx].id, roles, skipped };
}

/**
 * The list body: one line per role — emoji (if configured), bold name, then
 * the owner-written info text. Rendered into an embed description by the
 * service, so mentions can never ping.
 * @param {Array<{id:string,name:string}>} roles
 * @param {Record<string, {text?:string, emoji?:string}>} info
 */
export function renderSelfRolesLines(roles, info = {}) {
  return roles.map((role) => {
    const extra = info[role.id] ?? {};
    const emoji = extra.emoji ? `${extra.emoji} ` : '';
    const text = extra.text ? ` — ${extra.text}` : '';
    return `${emoji}**${role.name}**${text}`;
  });
}

/** Clamp a role name to a valid button label (Discord: ≤80 chars). */
export function buttonLabel(name) {
  const text = String(name ?? '').trim() || 'role';
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}
