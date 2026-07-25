// Heist leveling (S85 = M16.12 slice A, ported from maxcogs/heist leveling.py):
// the WoW-style cumulative XP table and the success bonus it feeds into the
// resolver. Pure — no store, no discord.js.
import { HEISTS } from './tables.js';

export const MAX_LEVEL = 120;

/** XP to go from level n to n+1: floor(100·n·(1 + 0.12·n)) — the cog's curve. */
export function xpForLevelStep(n) {
  return Math.floor(100 * n * (1 + 0.12 * n));
}

/**
 * Cumulative thresholds. XP_TABLE[i] = total XP needed to BE level i+1, so
 * XP_TABLE[0] = 0. 121 entries (levels 1…121), matching the cog's table.
 * NOTE: the cog's own comment claims "Level 1 -> 2: 212 XP"; its formula
 * actually yields 112. The formula is the truth (pinned in a test).
 */
export const XP_TABLE = (() => {
  const table = [];
  let total = 0;
  for (let level = 1; level <= MAX_LEVEL + 1; level += 1) {
    table.push(total);
    total += xpForLevelStep(level);
  }
  return table;
})();

/** Current level for a total XP amount (1…MAX_LEVEL). */
export function getLevel(totalXp) {
  let level = 1;
  for (let lvl = MAX_LEVEL; lvl >= 1; lvl -= 1) {
    if (totalXp >= XP_TABLE[lvl - 1]) {
      level = lvl;
      break;
    }
  }
  return Math.min(level, MAX_LEVEL);
}

/** XP still needed for the next level (0 at max level). */
export function xpForNextLevel(totalXp) {
  const level = getLevel(totalXp);
  if (level >= MAX_LEVEL) return 0;
  return XP_TABLE[level] - totalXp;
}

/** @returns {{level:number, into:number, span:number, pct:number}} */
export function xpProgress(totalXp) {
  const level = getLevel(totalXp);
  if (level >= MAX_LEVEL) return { level: MAX_LEVEL, into: 0, span: 0, pct: 1.0 };
  const start = XP_TABLE[level - 1];
  const end = XP_TABLE[level];
  const span = end - start;
  return { level, into: totalXp - start, span, pct: span > 0 ? (totalXp - start) / span : 1.0 };
}

/** Success-chance bonus from level: +0.5% each, capped at +20% (level 40). */
export function levelSuccessBonus(level) {
  return Math.min(level * 0.005, 0.20);
}

/** The cog's dot progress bar. */
export function xpBar(pct, length = 20) {
  const filled = Math.min(Math.round(pct * length), length);
  return `\`${'●'.repeat(filled)}${'○'.repeat(length - filled)}\` ${(pct * 100).toFixed(1)}%`;
}

/** XP for one outcome: caught pays nothing, a failure pays 20% (min 1). */
export function xpGain(heistType, success, caught) {
  if (caught) return 0;
  const base = HEISTS[heistType]?.xpReward ?? 50;
  return success ? base : Math.max(1, Math.trunc(base * 0.20));
}

/** Apply an XP gain, capping the total at the max-level threshold. */
export function applyXp(oldXp, gained) {
  const oldLevel = getLevel(oldXp);
  let newXp = oldXp + gained;
  const newLevel = Math.min(getLevel(newXp), MAX_LEVEL);
  if (newLevel >= MAX_LEVEL) newXp = Math.min(newXp, XP_TABLE[MAX_LEVEL - 1]);
  return { oldLevel, newLevel, newXp };
}
