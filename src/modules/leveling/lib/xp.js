// Pure XP / leveling math — no discord.js imports. Turns message + voice
// activity into XP, and XP into a position on the rank ladder. The event
// handlers and the store live elsewhere; everything here is deterministic and
// unit-tested. The ladder is passed in as a plain object (highest-first ranks),
// so this file never depends on academy — only on its shape.

export const DEFAULT_XP_CONFIG = {
  messageXp: 15, // XP per message (past the cooldown)
  messageCooldownMs: 60_000, // ignore messages within this window (anti-spam)
  voiceXpPerMin: 1, // S45 owner decision: "10 per voice minute is a lot — make it 1"
  baseXp: 1_000, // S45 owner decision: ranks must be a real challenge — the first one takes days, not minutes
  exponent: 1.8, // S45: steeper curve — the top ranks are a long-haul goal
};

/** XP to award for a message given the last-awarded time. 0 within cooldown. */
export function messageXpGain(config, lastMessageAt, now) {
  const cd = config.messageCooldownMs ?? DEFAULT_XP_CONFIG.messageCooldownMs;
  if (lastMessageAt && now - lastMessageAt < cd) return 0;
  return config.messageXp ?? DEFAULT_XP_CONFIG.messageXp;
}

/** XP to award for a span of eligible voice time (whole minutes only). */
export function voiceXpGain(config, elapsedMs) {
  const perMin = config.voiceXpPerMin ?? DEFAULT_XP_CONFIG.voiceXpPerMin;
  return Math.floor(Math.max(0, elapsedMs) / 60_000) * perMin;
}

/**
 * Cumulative XP thresholds, lowest rank first: thresholds[i] is the XP needed
 * to HOLD the (i+1)-th rank up from the bottom. Length = rankCount.
 */
export function thresholdsFor(rankCount, config = DEFAULT_XP_CONFIG) {
  const base = config.baseXp ?? DEFAULT_XP_CONFIG.baseXp;
  const exp = config.exponent ?? DEFAULT_XP_CONFIG.exponent;
  const out = [];
  for (let i = 0; i < rankCount; i += 1) out.push(Math.round(base * (i + 1) ** exp));
  return out;
}

/** How many ranks (from the bottom) this much XP has earned (0..rankCount). */
export function achievedRanks(xp, thresholds) {
  let n = 0;
  for (const t of thresholds) {
    if (xp >= t) n += 1;
    else break;
  }
  return n;
}

/**
 * The ladder entry this XP earns, or null when below the lowest rank.
 * `ladder.ranks` is ordered highest-first (index 0 = top), so the c-th rank
 * from the bottom is ranks[rankCount - c].
 * @returns {{ roleId:string, name:string }|null}
 */
export function targetRank(xp, ladder, config = DEFAULT_XP_CONFIG) {
  const rankCount = ladder.ranks.length;
  if (rankCount === 0) return null;
  const achieved = achievedRanks(xp, thresholdsFor(rankCount, config));
  if (achieved === 0) return null;
  return ladder.ranks[rankCount - achieved];
}

/**
 * XP to seed a member with, given the rank they ALREADY hold, so existing
 * members are coupled to their current rank instead of restarting at 0. We seed
 * to the FLOOR of that rank (the minimum XP consistent with holding it) so the
 * member keeps their rank and still has to earn the next one — never an instant
 * promotion. A member with no rank (rankIndex < 0) starts at 0.
 * @param {number} rankIndex 0 = top rank, rankCount-1 = bottom, -1 = no rank
 * @param {number} rankCount number of ranks on the ladder
 */
export function seedXpForRankIndex(rankIndex, rankCount, config = DEFAULT_XP_CONFIG) {
  if (rankIndex < 0 || rankCount <= 0 || rankIndex >= rankCount) return 0;
  const thresholds = thresholdsFor(rankCount, config);
  const fromBottom = rankCount - rankIndex; // 1 = bottom rank … rankCount = top
  return thresholds[fromBottom - 1];
}

/**
 * Which members in a voice channel earn voice XP this tick. Anti-farm rules:
 * nobody earns in the AFK channel; you must not be alone (≥2 humans present, so
 * two-person "AFK farms" still count but a lone user does not); self-deafened
 * members are treated as not participating. Bots never earn.
 * @param {Array<{id:string, bot?:boolean, selfDeaf?:boolean}>} members
 * @param {{ isAfkChannel?: boolean }} [ctx]
 * @returns {string[]} ids of members that should be awarded this tick
 */
export function eligibleVoiceMemberIds(members, { isAfkChannel = false } = {}) {
  if (isAfkChannel) return [];
  const humans = members.filter((m) => !m.bot);
  if (humans.length < 2) return [];
  return humans.filter((m) => !m.selfDeaf).map((m) => m.id);
}

/**
 * Plan a promote-only rank sync: the roles to change so the member holds the
 * rank their XP has earned. Never demotes — if the member already holds a rank
 * at or above what XP earns (e.g. manually promoted, or seeded), the plan is a
 * no-op. Demotion stays a deliberate human act via /demote.
 * @param {string[]} memberRoleIds roles the member holds
 * @param {{ranks: Array<{roleId:string,name:string}>}} ladder highest-first
 * @param {number} xp the member's XP
 * @returns {{ changed:false } | { changed:true, addRoleId:string, removeRoleIds:string[],
 *             fromName:string|null, toName:string }}
 */
export function planRankSync(memberRoleIds, ladder, xp, config = DEFAULT_XP_CONFIG) {
  const rankCount = ladder.ranks.length;
  if (rankCount === 0) return { changed: false };
  const target = targetRank(xp, ladder, config);
  if (!target) return { changed: false };

  const held = new Set(memberRoleIds);
  const targetIdx = ladder.ranks.findIndex((r) => r.roleId === target.roleId);
  const currentIdx = ladder.ranks.findIndex((r) => held.has(r.roleId));

  // Highest-first ladder: a lower index is a higher rank. Only move UP.
  if (currentIdx !== -1 && currentIdx <= targetIdx) return { changed: false };

  const removeRoleIds = ladder.ranks
    .map((r) => r.roleId)
    .filter((id) => held.has(id) && id !== target.roleId);
  return {
    changed: true,
    addRoleId: target.roleId,
    removeRoleIds,
    fromName: currentIdx === -1 ? null : ladder.ranks[currentIdx].name,
    toName: target.name,
  };
}

/**
 * The XP list (S42 owner request): which XP total earns which rank, lowest
 * rank first — exactly the thresholds the promote-only sync acts on.
 * @param {{ranks: Array<{roleId:string,name:string}>}} ladder highest-first
 * @returns {Array<{roleId:string, name:string, fromXp:number}>}
 */
export function ladderTable(ladder, config = DEFAULT_XP_CONFIG) {
  const rankCount = ladder.ranks.length;
  const thresholds = thresholdsFor(rankCount, config);
  return thresholds.map((fromXp, index) => ({
    ...ladder.ranks[rankCount - 1 - index],
    fromXp,
  }));
}

/**
 * Progress info for a /level card.
 * @returns {{ achieved:number, rankCount:number, currentFloor:number,
 *             nextThreshold:number|null, xpIntoRank:number, xpForNext:number|null }}
 */
export function levelProgress(xp, rankCount, config = DEFAULT_XP_CONFIG) {
  const thresholds = thresholdsFor(rankCount, config);
  const achieved = achievedRanks(xp, thresholds);
  const currentFloor = achieved === 0 ? 0 : thresholds[achieved - 1];
  const nextThreshold = achieved < rankCount ? thresholds[achieved] : null;
  return {
    achieved,
    rankCount,
    currentFloor,
    nextThreshold,
    xpIntoRank: xp - currentFloor,
    xpForNext: nextThreshold === null ? null : nextThreshold - xp,
  };
}
