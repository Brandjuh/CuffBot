// Patrol config helpers over the store, plus the wizard's RAM draft state.
// Screening logic is pure in lib/screen.js; wizard logic in lib/wizard.js.
import { getGuildData, setGuildData } from '../../core/store.js';
import { DEFAULT_PATROL_CONFIG } from './lib/screen.js';
import { WIZARD_TTL_MS } from './lib/wizard.js';

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

// ── wizard draft state (S47) ─────────────────────────────────────────────────
// RAM-only: an abandoned wizard evaporates after WIZARD_TTL_MS; nothing is
// written to the store until the admin hits Save on the review step.

const wizardDrafts = new Map(); // `${guildId}:${userId}` → { draft, expiresAt }

export function startWizardDraft(guildId, userId, draft, { now = Date.now(), ttlMs = WIZARD_TTL_MS } = {}) {
  wizardDrafts.set(`${guildId}:${userId}`, { draft, expiresAt: now + ttlMs });
  return draft;
}

/** The live draft, or null when none/expired (expired entries are removed). */
export function getWizardDraft(guildId, userId, { now = Date.now() } = {}) {
  const key = `${guildId}:${userId}`;
  const entry = wizardDrafts.get(key);
  if (!entry) return null;
  if (now >= entry.expiresAt) {
    wizardDrafts.delete(key);
    return null;
  }
  return entry.draft;
}

export function updateWizardDraft(guildId, userId, draft) {
  const entry = wizardDrafts.get(`${guildId}:${userId}`);
  if (entry) entry.draft = draft;
  return draft;
}

export function clearWizardDraft(guildId, userId) {
  wizardDrafts.delete(`${guildId}:${userId}`);
}
