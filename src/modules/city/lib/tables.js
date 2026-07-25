// City crime tables (S89 = M16.13 slice A, ported from CalaMari-Cogs/city
// crime/data.py). The five crimes are transcribed here with their cog values;
// the 96 random events were DUMPED from the Python source into
// `data/crime-events.json` rather than retyped, so there is no transcription
// step to get wrong. No discord.js imports.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * The cog's CRIME_TYPES. `requiresTarget` crimes steal a percentage of the
 * victim's balance instead of drawing a flat reward; `random` is the scenario
 * crime, whose numbers every scenario overrides (slice C).
 */
export const CRIMES = {
  pickpocket: {
    emoji: '🕶️',
    requiresTarget: true,
    minReward: 150,
    maxReward: 500,
    successRate: 0.6,
    cooldownMs: 10 * MINUTE,
    jailMs: 1 * HOUR,
    risk: 'low',
    fineMultiplier: 0.35,
    minStealPercentage: 0.01,
    maxStealPercentage: 0.10,
  },
  mugging: {
    emoji: '🥊',
    requiresTarget: true,
    minReward: 400,
    maxReward: 1500,
    successRate: 0.6,
    cooldownMs: 30 * MINUTE,
    jailMs: 90 * MINUTE,
    risk: 'medium',
    fineMultiplier: 0.4,
    minStealPercentage: 0.15,
    maxStealPercentage: 0.25,
  },
  rob_store: {
    emoji: '🏬',
    requiresTarget: false,
    minReward: 500,
    maxReward: 2000,
    successRate: 0.5,
    cooldownMs: 6 * HOUR,
    jailMs: 3 * HOUR,
    risk: 'medium',
    fineMultiplier: 0.4, // the cog's comment says 45%, its value says 40% — the value wins
  },
  bank_heist: {
    emoji: '🏦',
    requiresTarget: false,
    minReward: 1500,
    maxReward: 5000,
    successRate: 0.4,
    cooldownMs: 24 * HOUR,
    jailMs: 4 * HOUR,
    risk: 'high',
    fineMultiplier: 0.4,
  },
  random: {
    emoji: '🎲',
    requiresTarget: false,
    // Every number below is a placeholder the drawn scenario overrides.
    minReward: 100,
    maxReward: 3000,
    successRate: 0.5,
    cooldownMs: 1 * HOUR,
    jailMs: 10 * MINUTE,
    risk: 'random',
    fineMultiplier: 0.5,
  },
};

/** The cog's global_settings defaults. */
export const DEFAULT_CITY_SETTINGS = {
  allowBail: true,
  bailCostMultiplier: 1.6,
  minStealBalance: 100,
  maxStealAmount: 1000,
  defaultJailMs: 30 * MINUTE,
  defaultFineMultiplier: 0.5,
  protectLowBalance: true,
};

/** Streak rules: +5% per success, capped at +25%, reset after 24 h idle. */
export const STREAK_STEP = 0.05;
export const STREAK_CAP = 0.25;
export const STREAK_WINDOW_MS = 24 * HOUR;

// The event draw: the first is guaranteed, then 75% / 50% / 10%.
export const EVENT_CHANCES = [1, 0.75, 0.5, 0.1];

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

let eventCache = null;

/** The 96 crime events, exactly as the cog defines them (24 per crime). */
export function crimeEvents() {
  if (!eventCache) {
    eventCache = JSON.parse(readFileSync(path.join(dataDir, 'crime-events.json'), 'utf8'));
  }
  return eventCache;
}

/** Events available for one crime (the scenario crime has none of its own). */
export function eventsFor(crimeType) {
  return crimeEvents()[crimeType] ?? [];
}
