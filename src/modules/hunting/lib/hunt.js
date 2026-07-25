// Pure hunting logic (S66 = M16.1) — no discord.js, no store. A faithful port
// of vrt-cogs/hunting (docs/porting/S65-cog-surveys.md) re-themed for the
// precinct: birds become crooks, "bang" becomes the owner's STOP POLICE shout
// (S38 leading-phrase rule), and the eagle becomes an UNDERCOVER OFFICER you
// must salute, never cuff. Every random draw takes an injectable `random`.

// The wanted board. Weights are uniform, like the source cog's random.choice.
export const CROOKS = [
  { id: 'pickpocket', emoji: '🦹', line: '🦹 **_You’ll never catch me!_**' },
  { id: 'burglar', emoji: '🥷', line: '🥷 **_Just passing through!_**' },
  { id: 'getaway-driver', emoji: '🏎️', line: '🏎️ **_Eat my dust!_**' },
  { id: 'graffiti-tagger', emoji: '🎨', line: '🎨 **_The city is my canvas!_**' },
  { id: 'shoplifter', emoji: '🛍️', line: '🛍️ **_Five-finger discount!_**' },
  { id: 'smuggler', emoji: '📦', line: '📦 **_Nothing to declare!_**' },
  { id: 'mob-boss', emoji: '🕴️', line: '🕴️ **_You have no proof!_**' },
  // The eagle port: cuffing your own undercover colleague is BAD.
  { id: 'undercover-officer', emoji: '🕵️', line: '🕵️ **_Psst… I’m on duty here._**', undercover: true },
];

export const DEFAULT_HUNTING_CONFIG = {
  enabled: true,
  // S56 owner hunt channel stays the committed default enabled channel.
  channels: ['412354971170897921'],
  intervalMinS: 900, // vrt hunt_interval_minimum
  intervalMaxS: 3600, // vrt hunt_interval_maximum
  catchTimeoutS: 20, // vrt wait_for_bang_timeout
  mode: 'words', // 'words' (STOP POLICE) | 'reaction' (🚨/💥)
  showTime: false, // vrt bang_time: append the response time
  undercover: true, // vrt eagle toggle: the undercover-officer special spawns
  rewardMin: 100, // donuts per catch (kept from the S38 catch bounty)
  rewardMax: 300,
  escapeStealMin: 50, // an escaped crook pickpockets this much into the pot
  escapeStealMax: 250,
};

/** Pick tonight's crook — undercover officer only when the special is on. */
export function pickCrook(random = Math.random, { undercover = true } = {}) {
  const pool = undercover ? CROOKS : CROOKS.filter((c) => !c.undercover);
  return pool[Math.floor(random() * pool.length)];
}

/**
 * The fumble roll, byte-faithful to the cog: `random.randrange(0, 17) > 1`
 * is a HIT — so exactly 2 outcomes of 17 (≈11.8%) fumble the cuffs.
 */
export function fumbles(random = Math.random) {
  return Math.floor(random() * 17) <= 1;
}

/** Uniform spawn delay in ms (vrt: randint(interval_min, interval_max) seconds). */
export function nextSpawnDelayMs(config, random = Math.random) {
  const min = Math.max(60, config?.intervalMinS ?? DEFAULT_HUNTING_CONFIG.intervalMinS);
  const max = Math.max(min, config?.intervalMaxS ?? DEFAULT_HUNTING_CONFIG.intervalMaxS);
  return (min + Math.floor(random() * (max - min + 1))) * 1000;
}

/** A salute: the 🫡 emoji or the word "salute" anywhere in the message. */
export function isSalute(content) {
  const text = String(content ?? '');
  return text.includes('🫡') || /\bsalutes?\b/i.test(text);
}

/**
 * Resolve a shout at an active crook. `kind` is 'catch' (STOP POLICE / 🚨)
 * or 'salute' (🫡). Deviation from the cog (recorded): the fumble roll runs
 * for every outcome, exactly like the source's single `randrange` gate.
 * @returns {'fumbled'|'caught'|'cuffed-colleague'|'saluted'|'ignored'}
 */
export function resolveShout(crook, kind, random = Math.random) {
  const undercover = Boolean(crook?.undercover);
  if (!undercover && kind === 'salute') return 'ignored'; // only the officer wants a salute
  if (fumbles(random)) return 'fumbled';
  if (undercover) return kind === 'salute' ? 'saluted' : 'cuffed-colleague';
  return 'caught';
}

/** Inclusive reward roll (deviation: the cog's randint(min, max+1) off-by-one is not ported). */
export function rollReward(config, random = Math.random) {
  const min = config?.rewardMin ?? DEFAULT_HUNTING_CONFIG.rewardMin;
  const max = Math.max(min, config?.rewardMax ?? DEFAULT_HUNTING_CONFIG.rewardMax);
  return min + Math.floor(random() * (max - min + 1));
}

/** Merge a catch into a member's score record { total, byCrook }. */
export function addCatch(record, crookId) {
  const byCrook = { ...(record?.byCrook ?? {}) };
  byCrook[crookId] = (byCrook[crookId] ?? 0) + 1;
  return { total: (record?.total ?? 0) + 1, byCrook };
}

/** Response-time suffix, vrt-style: " in 3.2s" (only when showTime is on). */
export function formatResponseTime(ms) {
  return ` in ${(ms / 1000).toFixed(1)}s`;
}
