// The heist resolver (S85 = M16.12 slice A, ported from maxcogs/heist
// handlers.py resolve_heist). PURE: it takes a snapshot of the officer's
// state plus an rng and returns the outcome AND the next state — no store
// writes, no Discord, no clock of its own. The service layer (slice B)
// applies `nextState` and pays `balanceDelta` through the economy seam.
//
// The cog's order of operations is preserved exactly, because the RNG call
// ORDER is part of the behavior: success roll → reward/loss roll → material
// drop → police roll → bail. Tests script whole outcomes with a seeded rng.
import { ITEMS, MATERIAL_ITEMS } from './tables.js';
import { applyXp, levelSuccessBonus, xpGain, xpProgress } from './leveling.js';

/** Python's random surface, the four calls the cog makes. */
export const defaultRng = {
  /** randint: inclusive on both ends. */
  int: (min, max) => min + Math.floor(Math.random() * (max - min + 1)),
  /** random(): [0, 1). */
  float: () => Math.random(),
  /** uniform(a, b). */
  uniform: (a, b) => a + (b - a) * Math.random(),
  /** choice(seq). */
  pick: (list) => list[Math.floor(Math.random() * list.length)],
};

/** The cog's heat decay: −1 per full 2 hours idle, never below 0. */
export function decayedHeat(heat, heatLastSet, now) {
  if (heat <= 0) return 0;
  if (heatLastSet == null) return heat;
  const hoursIdle = (now - heatLastSet) / 3_600_000;
  const decay = Math.trunc(hoursIdle / 2);
  if (decay <= 0) return heat;
  return Math.max(0, heat - decay);
}

/** Bail = the drawn amount + the cog's flat 15% tax. */
export function bailTotal(bailAmount) {
  return bailAmount + Math.trunc(bailAmount * 0.15);
}

const countOf = (inventory, id) => inventory[id] ?? 0;

function removeOne(inventory, id) {
  const left = Math.max(0, countOf(inventory, id) - 1);
  if (left === 0) delete inventory[id];
  else inventory[id] = left;
  return left;
}

/**
 * Resolve one heist.
 *
 * @param {object} input
 * @param {string} input.heistType
 * @param {object} input.heist          the HEISTS entry (or an admin-tuned copy)
 * @param {object} input.player         { inventory, equipped:{shield,tool}, heat, materialHeat, debt, xp, stats }
 * @param {number} input.balance        the officer's current donut balance
 * @param {number} [input.eventMultiplier=1]
 * @param {boolean} [input.taxAgreed=false]  they accepted the 20% debt tax
 * @param {number} input.now            epoch ms (jail end is computed from it)
 * @param {object} [rng=defaultRng]
 * @returns {object} outcome + nextState
 */
export function resolveHeist(
  { heistType, heist, player, balance, eventMultiplier = 1, taxAgreed = false, now },
  rng = defaultRng,
) {
  const inventory = { ...player.inventory };
  const equipped = { ...player.equipped };
  const stats = { success: 0, fail: 0, caught: 0, ...player.stats };
  let debt = player.debt ?? 0;

  // 1. The equipped tool is consumed whatever happens — the cog spends it
  //    before the roll and unequips when the last one is gone.
  let toolBoost = 0;
  let toolUsed = null;
  const equippedTool = equipped.tool;
  if (equippedTool && countOf(inventory, equippedTool) > 0 && ITEMS[equippedTool]?.forHeist === heistType) {
    toolBoost = ITEMS[equippedTool].boost ?? 0;
    toolUsed = equippedTool;
    if (removeOne(inventory, equippedTool) === 0) equipped.tool = null;
  }

  // 2. Success: the drawn base, plus the tool boost as WHOLE percent points
  //    (Python int() truncation preserved), plus the level bonus, capped.
  const level = xpProgress(player.xp ?? 0).level;
  const levelBonus = levelSuccessBonus(level);
  const baseSuccess = rng.int(heist.minSuccess, heist.maxSuccess);
  const successChance = Math.min((baseSuccess + Math.trunc(toolBoost * 100)) / 100 + levelBonus, 1.0);
  const success = rng.float() < successChance;

  // A job named after a loot item pays in that item instead of currency.
  const lootItem = ITEMS[heistType]?.type === 'loot' ? heistType : null;

  let reward = 0;
  let baseReward = 0;
  let loss = 0;
  let lossPaid = 0;
  let debtAdded = 0;
  let debtTax = 0;
  let shieldUsed = null;
  let shieldReduction = 0;
  let shieldAbsorbedAll = false;

  if (success) {
    if (lootItem) {
      inventory[lootItem] = countOf(inventory, lootItem) + 1;
    } else {
      baseReward = rng.int(heist.minReward, heist.maxReward);
      reward = baseReward * eventMultiplier;
    }
  } else {
    loss = rng.int(heist.minLoss, heist.maxLoss);
    const equippedShield = equipped.shield;
    if (equippedShield && countOf(inventory, equippedShield) > 0) {
      shieldReduction = ITEMS[equippedShield]?.reduction ?? 0;
      shieldUsed = equippedShield;
      if (removeOne(inventory, equippedShield) === 0) equipped.shield = null;
    }
    loss = Math.trunc(loss * (1 - shieldReduction));
    if (loss > 0) {
      if (balance >= loss) {
        lossPaid = loss;
      } else {
        // Can't pay: it becomes debt, with the 20% tax when they agreed to it.
        debtAdded = loss;
        if (taxAgreed) {
          debtTax = Math.trunc(loss * 0.2);
          debtAdded += debtTax;
        }
        debt += debtAdded;
      }
    } else {
      shieldAbsorbedAll = true;
    }
  }

  // 3. Heat rises before the police roll (the cog increments first).
  const heat = (player.heat ?? 0) + 1;
  let materialHeat = (player.materialHeat ?? 0) + 1;

  // 4. Material drop — the pity counter raises the odds 4 points per heist
  //    without a drop and resets on one.
  let materialDrop = null;
  const dropChance = Math.min((heist.materialDropChance ?? 0) + materialHeat * 0.04, 0.9);
  if (rng.float() < dropChance) {
    materialHeat = 0;
    const pool = heist.materialTiers ?? MATERIAL_ITEMS;
    if (pool.length > 0) {
      const item = rng.pick(pool);
      const qty = success ? rng.int(1, 3) : rng.int(1, 2);
      inventory[item] = countOf(inventory, item) + qty;
      materialDrop = { item, qty };
    }
  }

  // 5. The police roll is independent of success and rises 2 points per heat.
  let caught = false;
  let jail = null;
  let confiscated = null;
  let seized = 0;
  let finalHeat = heat;
  const policeChance = Math.min((heist.policeChance ?? 0) + heat * 0.02, 0.9);
  if (rng.float() < policeChance) {
    caught = true;
    finalHeat = 0; // an arrest clears the record
    const bail = Math.trunc(heist.maxLoss * rng.uniform(0.5, 1.0));
    jail = { endsAt: now + heist.jailMs, bail, bailTax: Math.trunc(bail * 0.15), bailTotal: bailTotal(bail) };

    if (success) {
      if (lootItem && countOf(inventory, lootItem) > 0) {
        removeOne(inventory, lootItem);
        confiscated = lootItem;
      } else if (reward > 0) {
        seized = reward; // taken straight back out of the balance
      }
    } else {
      // A failed job still costs you a piece of the collection.
      const lootHeld = Object.keys(inventory).filter((id) => ITEMS[id]?.type === 'loot');
      if (lootHeld.length > 0) {
        const item = rng.pick(lootHeld);
        if (countOf(inventory, item) > 0) {
          removeOne(inventory, item);
          confiscated = item;
        }
      }
    }
  }

  if (caught) stats.caught += 1;
  else if (success) stats.success += 1;
  else stats.fail += 1;

  const gained = xpGain(heistType, success, caught);
  const { oldLevel, newLevel, newXp } = applyXp(player.xp ?? 0, gained);

  return {
    success,
    caught,
    heistType,
    toolUsed,
    toolBoost,
    baseSuccess,
    levelBonus,
    successChance,
    lootItem: success && lootItem ? lootItem : null,
    baseReward,
    reward,
    eventMultiplier,
    loss,
    lossPaid,
    shieldUsed,
    shieldReduction,
    shieldAbsorbedAll,
    debtAdded,
    debtTax,
    seized,
    confiscated,
    materialDrop,
    jail,
    /** Net donut movement the service must apply through the economy seam. */
    balanceDelta: reward - seized - lossPaid,
    xpGained: gained,
    oldLevel,
    newLevel,
    nextState: {
      inventory,
      equipped,
      heat: finalHeat,
      heatLastSet: now,
      materialHeat,
      debt,
      xp: newXp,
      stats,
    },
  };
}

/**
 * Resolve a crew robbery (S88 = slice D, the cog's `resolve_crew_heist`).
 * Also pure. Two things differ from a solo job and both are load-bearing:
 *
 *   1. ONE shared success roll decides for the whole crew, and it uses the
 *      raw drawn percentage — no tool boost, no level bonus.
 *   2. Per member the police roll comes BEFORE the material drop (a solo job
 *      does it the other way round), and a material drop is 1–2 either way.
 *
 * The haul (or the loss) is drawn once and split `total // crew`, so a bigger
 * crew means a thinner cut. There is no loot item and nothing is confiscated.
 *
 * @param {object} input
 * @param {Array<{userId:string, player:object, balance:number, taxAgreed?:boolean}>} input.members
 * @returns {object} the shared result plus a per-member breakdown
 */
export function resolveCrewHeist(
  { heistType, heist, members, eventMultiplier = 1, now },
  rng = defaultRng,
) {
  const baseSuccess = rng.int(heist.minSuccess, heist.maxSuccess);
  const successChance = baseSuccess / 100;
  const success = rng.float() < successChance;

  let totalReward = 0;
  let totalLoss = 0;
  if (success) totalReward = rng.int(heist.minReward, heist.maxReward) * eventMultiplier;
  else totalLoss = rng.int(heist.minLoss, heist.maxLoss);

  const crewSize = members.length;
  const perMemberReward = success ? Math.trunc(totalReward / crewSize) : 0;
  const perMemberLoss = success ? 0 : Math.trunc(totalLoss / crewSize);

  const results = members.map(({ userId, player, balance, taxAgreed = false }) => {
    const inventory = { ...player.inventory };
    const equipped = { ...player.equipped };
    const stats = { success: 0, fail: 0, caught: 0, ...player.stats };
    let debt = player.debt ?? 0;

    // Faithful but currently unreachable: no tool in the cog's table names
    // crew_robbery as its heist, so this branch never fires today.
    let toolBoost = 0;
    let toolUsed = null;
    const equippedTool = equipped.tool;
    if (equippedTool && countOf(inventory, equippedTool) > 0 && ITEMS[equippedTool]?.forHeist === heistType) {
      toolBoost = ITEMS[equippedTool].boost ?? 0;
      toolUsed = equippedTool;
      if (removeOne(inventory, equippedTool) === 0) equipped.tool = null;
    }

    let reward = 0;
    let loss = 0;
    let lossPaid = 0;
    let debtAdded = 0;
    let debtTax = 0;
    let shieldUsed = null;
    let shieldReduction = 0;

    if (success) {
      reward = toolBoost > 0 ? Math.trunc(perMemberReward * (1 + toolBoost)) : perMemberReward;
    } else {
      loss = perMemberLoss;
      const equippedShield = equipped.shield;
      if (equippedShield && countOf(inventory, equippedShield) > 0) {
        shieldReduction = ITEMS[equippedShield]?.reduction ?? 0;
        shieldUsed = equippedShield;
        if (removeOne(inventory, equippedShield) === 0) equipped.shield = null;
      }
      loss = Math.trunc(loss * (1 - shieldReduction));
      if (balance >= loss) {
        lossPaid = loss;
      } else {
        debtAdded = loss;
        if (taxAgreed) {
          debtTax = Math.trunc(loss * 0.2);
          debtAdded += debtTax;
        }
        debt += debtAdded;
      }
    }

    const heat = (player.heat ?? 0) + 1;
    let finalHeat = heat;

    // Police BEFORE materials — the crew path's order, not the solo one's.
    let caught = false;
    let jail = null;
    const policeChance = Math.min((heist.policeChance ?? 0) + heat * 0.02, 0.9);
    if (rng.float() < policeChance) {
      caught = true;
      finalHeat = 0;
      const bail = Math.trunc(heist.maxLoss * rng.uniform(0.5, 1.0));
      jail = { endsAt: now + heist.jailMs, bail, bailTax: Math.trunc(bail * 0.15), bailTotal: bailTotal(bail) };
    }

    let materialHeat = (player.materialHeat ?? 0) + 1;
    let materialDrop = null;
    const dropChance = Math.min((heist.materialDropChance ?? 0) + materialHeat * 0.04, 0.9);
    if (rng.float() < dropChance) {
      materialHeat = 0;
      const pool = heist.materialTiers ?? MATERIAL_ITEMS;
      if (pool.length > 0) {
        const item = rng.pick(pool);
        const qty = rng.int(1, 2); // crew drops are always 1–2, win or lose
        inventory[item] = countOf(inventory, item) + qty;
        materialDrop = { item, qty };
      }
    }

    if (caught) stats.caught += 1;
    else if (success) stats.success += 1;
    else stats.fail += 1;

    const gained = xpGain(heistType, success, caught);
    const { oldLevel, newLevel, newXp } = applyXp(player.xp ?? 0, gained);

    return {
      userId,
      reward,
      loss,
      lossPaid,
      debtAdded,
      debtTax,
      shieldUsed,
      toolUsed,
      toolBoost,
      caught,
      jail,
      materialDrop,
      xpGained: gained,
      oldLevel,
      newLevel,
      balanceDelta: reward - lossPaid,
      nextState: {
        inventory,
        equipped,
        heat: finalHeat,
        heatLastSet: now,
        materialHeat,
        debt,
        xp: newXp,
        stats,
      },
    };
  });

  return {
    heistType,
    success,
    baseSuccess,
    totalReward,
    totalLoss,
    perMemberReward,
    perMemberLoss,
    eventMultiplier,
    anyCaught: results.some((result) => result.caught),
    members: results,
  };
}
