// Pure rank-ladder logic — no discord.js imports, so promotion/demotion math is
// fully testable without a guild. The ladder is NOT a fixed police chain; it is
// the server's own rank roles (e.g. an existing leveler bot's ranks), detected
// from the roles positioned under a "[LEVELER]"-style header role and ordered
// highest-first. Everything here works on plain role objects and ids.

/** A role name that reads as a section divider ("[LEVELER]", "▬▬▬", …). */
export function isSectionDivider(name) {
  if (typeof name !== 'string') return false;
  return /^[\s\W]*\[[^\]]+\][\s\W]*$/.test(name) || /[▬━─═_=~-]{2,}/.test(name.replace(/\s/g, ''));
}

/** Heuristic: does this role look like the leveler/rank section header? */
export function looksLikeHeader(name) {
  return typeof name === 'string' && /level|rank/i.test(name);
}

/**
 * Build the rank ladder from the guild's roles.
 * @param {Array<{id:string,name:string,managed?:boolean,position?:number}>} rolesDesc
 *   the guild's roles ordered highest position first.
 * @param {{ headerRoleId?:string|null, excludedRoleIds?:string[] }} [config]
 * @returns {{ ranks: Array<{roleId:string,name:string}>, headerFound:boolean, headerRoleId:string|null }}
 *   ranks are ordered highest rank first (index 0 = top of the ladder).
 */
export function buildLadder(rolesDesc, config = {}) {
  const excluded = new Set(config.excludedRoleIds ?? []);
  let headerIdx = -1;
  if (config.headerRoleId) headerIdx = rolesDesc.findIndex((r) => r.id === config.headerRoleId);
  if (headerIdx < 0) headerIdx = rolesDesc.findIndex((r) => looksLikeHeader(r.name));
  if (headerIdx < 0) return { ranks: [], headerFound: false, headerRoleId: null };

  const ranks = [];
  for (let i = headerIdx + 1; i < rolesDesc.length; i += 1) {
    const role = rolesDesc[i];
    if (role.name === '@everyone') continue;
    if (role.managed) continue; // bot / integration / booster roles are not ranks
    if (excluded.has(role.id)) continue;
    if (isSectionDivider(role.name)) break; // the next section ends the rank block
    ranks.push({ roleId: role.id, name: role.name });
  }
  return { ranks, headerFound: true, headerRoleId: rolesDesc[headerIdx].id };
}

/** Index (0 = highest) of the top rank the member holds, or -1 for none. */
export function currentRankIndex(memberRoleIds, ladder) {
  const held = new Set(memberRoleIds);
  return ladder.ranks.findIndex((r) => held.has(r.roleId));
}

/** The member's current rank {roleId,name}, or null. Exposed for reuse (/badge). */
export function currentRank(memberRoleIds, ladder) {
  const i = currentRankIndex(memberRoleIds, ladder);
  return i < 0 ? null : ladder.ranks[i];
}

function heldRankRoleIds(memberRoleIds, ladder) {
  const held = new Set(memberRoleIds);
  return ladder.ranks.map((r) => r.roleId).filter((id) => held.has(id));
}

// Ranks are ordered highest-first, so a HIGHER rank has a LOWER index.
function buildPlan(ladder, memberRoleIds, curIdx, targetIdx) {
  const target = ladder.ranks[targetIdx];
  const removeRoleIds = heldRankRoleIds(memberRoleIds, ladder).filter((id) => id !== target.roleId);
  return {
    ok: true,
    from: curIdx < 0 ? null : ladder.ranks[curIdx].name,
    to: target.name,
    addRoleId: memberRoleIds.includes(target.roleId) ? null : target.roleId,
    removeRoleIds,
  };
}

/**
 * Plan a promotion: one rung up, or straight to `toRoleId` if given and higher.
 * A member with no rank is inducted at the lowest rank.
 */
export function planPromotion(ladder, memberRoleIds, toRoleId = null) {
  if (ladder.ranks.length === 0) return { ok: false, code: 'ladder-unconfigured' };
  const curIdx = currentRankIndex(memberRoleIds, ladder);
  const bottom = ladder.ranks.length - 1;

  let targetIdx;
  if (toRoleId) {
    targetIdx = ladder.ranks.findIndex((r) => r.roleId === toRoleId);
    if (targetIdx < 0) return { ok: false, code: 'unknown-rank' };
    if (curIdx >= 0 && targetIdx >= curIdx) {
      return { ok: false, code: 'target-not-higher', current: ladder.ranks[curIdx].name };
    }
  } else {
    if (curIdx === 0) return { ok: false, code: 'already-top', current: ladder.ranks[0].name };
    targetIdx = curIdx < 0 ? bottom : curIdx - 1;
  }
  return buildPlan(ladder, memberRoleIds, curIdx, targetIdx);
}

/** Plan a demotion: one rung down, or straight to `toRoleId` if given and lower. */
export function planDemotion(ladder, memberRoleIds, toRoleId = null) {
  if (ladder.ranks.length === 0) return { ok: false, code: 'ladder-unconfigured' };
  const curIdx = currentRankIndex(memberRoleIds, ladder);
  if (curIdx < 0) return { ok: false, code: 'no-rank-to-demote' };
  const bottom = ladder.ranks.length - 1;

  let targetIdx;
  if (toRoleId) {
    targetIdx = ladder.ranks.findIndex((r) => r.roleId === toRoleId);
    if (targetIdx < 0) return { ok: false, code: 'unknown-rank' };
    if (targetIdx <= curIdx) {
      return { ok: false, code: 'target-not-lower', current: ladder.ranks[curIdx].name };
    }
  } else {
    if (curIdx === bottom) return { ok: false, code: 'already-bottom', current: ladder.ranks[bottom].name };
    targetIdx = curIdx + 1;
  }
  return buildPlan(ladder, memberRoleIds, curIdx, targetIdx);
}
