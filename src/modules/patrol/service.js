// Patrol config helpers over the store. Kept tiny; the screening logic is pure
// in lib/screen.js.
import { getGuildData, setGuildData } from '../../core/store.js';
import { DEFAULT_PATROL_CONFIG } from './lib/screen.js';

export const PATROL_CONFIG_KEY = 'patrolConfig';

export function getPatrolConfig(guildId, options = {}) {
  const stored = getGuildData(guildId, PATROL_CONFIG_KEY, {}, options);
  return {
    ...DEFAULT_PATROL_CONFIG,
    ...stored,
    rules: { ...DEFAULT_PATROL_CONFIG.rules, ...(stored.rules ?? {}) },
    bannedTerms: stored.bannedTerms ?? [],
  };
}

export function setPatrolConfig(guildId, config, options = {}) {
  return setGuildData(guildId, PATROL_CONFIG_KEY, config, options);
}
