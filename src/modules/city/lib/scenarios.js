// City scenarios (S91 = M16.13 slice C, ported from CalaMari-Cogs/city
// crime/scenarios.py). Both tables were DUMPED from the Python source — the
// 46 random-crime scenarios and the 14 prison-break scenarios — so nothing was
// retyped. The cog wrote their numbers as module constants (RISK_MEDIUM,
// SUCCESS_RATE_LOW…); those were resolved during the dump.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRIMES } from './tables.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

let scenarioCache = null;
let breakCache = null;

/** The 46 one-off crimes behind `!crime random`. */
export function randomScenarios() {
  if (!scenarioCache) scenarioCache = JSON.parse(readFileSync(path.join(dataDir, 'scenarios.json'), 'utf8'));
  return scenarioCache;
}

/** The 14 prison-break scripts, each with its own events. */
export function prisonBreaks() {
  if (!breakCache) breakCache = JSON.parse(readFileSync(path.join(dataDir, 'prison-breaks.json'), 'utf8'));
  return breakCache;
}

export const pickScenario = (rng) => rng.pick(randomScenarios());
export const pickPrisonBreak = (rng) => rng.pick(prisonBreaks());

/**
 * Turn a scenario into the crime shape the resolver expects: it overrides the
 * `random` crime's reward range, odds, sentence and fine, but keeps that
 * crime's cooldown (the cog only overrides the numbers listed here).
 */
export function scenarioToCrime(scenario) {
  return {
    ...CRIMES.random,
    minReward: scenario.min_reward,
    maxReward: scenario.max_reward,
    successRate: scenario.success_rate,
    jailMs: scenario.jail_time * 1000,
    fineMultiplier: scenario.fine_multiplier,
    risk: scenario.risk,
  };
}

/**
 * Resolve a jailbreak attempt — pure. Unlike a crime, EVERY event in the
 * drawn scenario applies (there is no probability draw), each shifting the
 * odds and possibly the wallet; then one roll decides.
 *
 * @returns {{success:boolean, chance:number, events:Array, currencyChange:number}}
 */
export function resolveJailbreak(scenario, rng) {
  let chance = scenario.base_chance;
  let currencyChange = 0;
  for (const event of scenario.events ?? []) {
    if ('chance_bonus' in event) chance = Math.min(1.0, chance + event.chance_bonus);
    else if ('chance_penalty' in event) chance = Math.max(0.05, chance - event.chance_penalty);
    if ('currency_bonus' in event) currencyChange += event.currency_bonus;
    else if ('currency_penalty' in event) currencyChange -= event.currency_penalty;
  }
  return { success: rng.float() < chance, chance, events: scenario.events ?? [], currencyChange };
}

/** A failed break stretches what is LEFT of the sentence by 30% (cog rule). */
export const failedBreakExtension = (remainingMs) => Math.trunc(remainingMs * 0.3);
