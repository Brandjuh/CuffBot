// The city crime resolver (S89 = M16.13 slice A, ported from
// CalaMari-Cogs/city crime/views.py + utils.py). PURE: state snapshot + rng
// in, outcome out — no store, no Discord, no clock of its own.
//
// The cog's ORDER is preserved because it is observable: draw the events →
// fold their modifiers into chance/jail/credits → roll → on success apply the
// streak multiplier FIRST and each event's reward multiplier after it, each
// with its own rounding → add the direct credit changes last.
import { CRIMES, DEFAULT_CITY_SETTINGS, EVENT_CHANCES, STREAK_CAP, STREAK_STEP, STREAK_WINDOW_MS, eventsFor } from './tables.js';

/** Python's random surface, the calls this cog makes. */
export const defaultRng = {
  int: (min, max) => min + Math.floor(Math.random() * (max - min + 1)),
  float: () => Math.random(),
  uniform: (a, b) => a + (b - a) * Math.random(),
  pick: (list) => list[Math.floor(Math.random() * list.length)],
};

/** The cog's calculate_streak_bonus: 1.0 + min(0.25, streak × 0.05). */
export function streakBonus(streak) {
  if (streak <= 0) return 1.0;
  return 1.0 + Math.min(STREAK_CAP, streak * STREAK_STEP);
}

/**
 * The cog's update_streak, as a pure step: a gap over 24 h wipes the streak
 * before the outcome is applied, a success increments, a failure resets.
 * @returns {{streak:number, highest:number, multiplier:number}}
 */
export function nextStreak({ streak = 0, highest = 0, lastCrimeAt = 0 }, success, now) {
  let current = now - lastCrimeAt > STREAK_WINDOW_MS ? 0 : streak;
  current = success ? current + 1 : 0;
  return {
    streak: current,
    highest: Math.max(highest, current),
    multiplier: streakBonus(current),
  };
}

/**
 * Draw this attempt's events — the first is guaranteed, then 75%, 50%, 10%,
 * each drawn WITHOUT replacement from the crime's own pool.
 */
export function drawEvents(crimeType, rng = defaultRng) {
  const available = [...eventsFor(crimeType)];
  const drawn = [];
  for (const chance of EVENT_CHANCES) {
    if (available.length === 0) break;
    if (chance < 1 && !(rng.float() < chance)) continue;
    const event = rng.pick(available);
    drawn.push(event);
    available.splice(available.indexOf(event), 1);
  }
  return drawn;
}

/**
 * Fold the drawn events into the attempt. Chance bonuses clamp at 1.0 and
 * penalties at 0.05 (the cog's floors), jail multiplies cumulatively with
 * truncation at each step, and direct credit effects are summed apart from
 * the multipliers.
 */
export function applyEvents(events, { successChance, jailMs }) {
  let chance = successChance;
  let jail = jailMs;
  let jailMultiplier = 1;
  let creditChange = 0;
  for (const event of events) {
    if ('chance_bonus' in event) chance = Math.min(1.0, chance + event.chance_bonus);
    else if ('chance_penalty' in event) chance = Math.max(0.05, chance - event.chance_penalty);
    if ('jail_multiplier' in event) {
      jail = Math.trunc(jail * event.jail_multiplier);
      jailMultiplier *= event.jail_multiplier;
    }
    if ('credits_bonus' in event) creditChange += event.credits_bonus;
    else if ('credits_penalty' in event) creditChange -= event.credits_penalty;
  }
  return { successChance: chance, jailMs: jail, jailMultiplier, creditChange };
}

/**
 * What a targeted crime takes: a random slice of the victim's balance, capped
 * by the settings AND the crime's own max reward, floored at the crime's min
 * reward when the victim can cover it (the cog's calculate_stolen_amount).
 */
export function stolenAmount(crime, targetBalance, settings, rng = defaultRng) {
  if (crime.minStealPercentage === undefined) return rng.int(crime.minReward, crime.maxReward);
  const percentage = rng.uniform(crime.minStealPercentage, crime.maxStealPercentage);
  let amount = Math.trunc(targetBalance * percentage);
  amount = Math.min(amount, settings.maxStealAmount ?? DEFAULT_CITY_SETTINGS.maxStealAmount);
  amount = Math.min(amount, crime.maxReward);
  if (amount < crime.minReward && targetBalance >= crime.minReward / crime.minStealPercentage) {
    amount = crime.minReward;
  }
  return amount;
}

/** Is this crime still cooling down for that member? */
export function crimeCooldownLeft(cooldowns, crimeType, now, cooldownMs = null) {
  const last = cooldowns?.[crimeType];
  if (!last) return 0;
  const window = cooldownMs ?? CRIMES[crimeType]?.cooldownMs ?? 0;
  return Math.max(0, last + window - now);
}

/** Time left on a jail sentence (0 = free). */
export function jailLeft(member, now) {
  if (!member?.jailMs || !member?.jailStartedAt) return 0;
  return Math.max(0, member.jailStartedAt + member.jailMs - now);
}

/** Bail for the remaining sentence: the cog charges 1.6× the minutes left. */
export function bailCost(remainingMs, settings = DEFAULT_CITY_SETTINGS) {
  const minutes = Math.ceil(remainingMs / 60_000);
  return Math.trunc(minutes * (settings.bailCostMultiplier ?? 1.6));
}

/**
 * Resolve one crime attempt.
 *
 * @param {object} input
 * @param {string} input.crimeType
 * @param {object} input.crime            the CRIMES entry, or a scenario's override
 * @param {object} input.member           { streak, highest, lastCrimeAt, balance }
 * @param {number} [input.targetBalance]  required for a targeted crime
 * @param {object} [input.settings]
 * @param {number} input.now
 * @returns {object} the whole attempt, including what the caller must apply
 */
export function resolveCrime(
  { crimeType, crime, member, targetBalance = 0, settings = DEFAULT_CITY_SETTINGS, now },
  rng = defaultRng,
) {
  const events = drawEvents(crimeType, rng);
  const folded = applyEvents(events, { successChance: crime.successRate, jailMs: crime.jailMs });
  const success = rng.float() < folded.successChance;
  const streak = nextStreak(member, success, now);

  if (success) {
    const base = crime.requiresTarget
      ? stolenAmount(crime, targetBalance, settings, rng)
      : rng.int(crime.minReward, crime.maxReward);
    // The cog rounds after the streak multiplier, then again after EVERY
    // event multiplier — not once at the end. Reproduce that step by step.
    const steps = [{ label: 'Base amount', amount: base }];
    let amount = base;
    if (streak.streak > 0) {
      amount = Math.round(amount * streak.multiplier);
      steps.push({ label: `Streak ×${streak.streak}`, amount, multiplier: streak.multiplier });
    }
    for (const event of events) {
      if ('reward_multiplier' in event) {
        amount = Math.round(amount * event.reward_multiplier);
        steps.push({ label: event.text, amount, multiplier: event.reward_multiplier });
      }
    }
    const payout = amount + folded.creditChange;
    return {
      crimeType,
      success: true,
      events,
      successChance: folded.successChance,
      baseAmount: base,
      steps,
      creditChange: folded.creditChange,
      payout,
      // On a targeted crime the WHOLE transfer comes out of the victim — the
      // cog withdraws `reward + credit changes` from them, not just the base.
      // The caller clamps it to what the victim actually holds.
      stolenFromTarget: crime.requiresTarget ? payout : 0,
      streak,
      jailMs: 0,
      fine: 0,
    };
  }

  // Failure: the fine is a flat share of the crime's ceiling. If the member
  // cannot pay it, the cog confiscates everything they have and DOUBLES the
  // sentence instead.
  const fine = Math.trunc(crime.maxReward * crime.fineMultiplier);
  const balance = member.balance ?? 0;
  const canPay = balance >= fine;
  const jailMs = canPay ? folded.jailMs : folded.jailMs * 2;
  return {
    crimeType,
    success: false,
    events,
    successChance: folded.successChance,
    creditChange: folded.creditChange,
    fine,
    finePaid: canPay ? fine : Math.max(0, balance),
    brokeAndDoubled: !canPay,
    jailMs,
    jailMultiplier: folded.jailMultiplier,
    payout: folded.creditChange,
    stolenFromTarget: 0,
    streak,
  };
}
