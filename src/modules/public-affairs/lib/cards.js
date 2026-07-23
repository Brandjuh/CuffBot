// Pure embed/text construction for the community commands — no discord.js
// imports, so all the formatting and the deterministic pickers are testable.

/** Stable 32-bit hash of a string — lets fun picks be deterministic per seed. */
export function hashSeed(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(list, seed) {
  return list[hashSeed(seed) % list.length];
}

// --- /badge ------------------------------------------------------------------

/**
 * @param {{ displayName, joinedTimestamp?:number|null, rankName?:string|null,
 *           recordCount:number, avatarURL?:string|null }} data
 * @returns {object} APIEmbed
 */
export function badgeEmbed({ displayName, joinedTimestamp = null, rankName = null, recordCount = 0, avatarURL = null }) {
  const embed = {
    title: `🪪 Officer Badge — ${displayName}`,
    color: 0x5a86c9,
    fields: [
      { name: 'Rank', value: rankName ?? 'Unranked', inline: true },
      { name: 'Record', value: `${recordCount} ${recordCount === 1 ? 'entry' : 'entries'}`, inline: true },
      {
        name: 'On the force since',
        value: joinedTimestamp ? `<t:${Math.floor(joinedTimestamp / 1000)}:D>` : 'unknown',
        inline: true,
      },
    ],
  };
  if (avatarURL) embed.thumbnail = { url: avatarURL };
  return embed;
}

// --- /wanted -----------------------------------------------------------------

const CRIMES = [
  'jaywalking across the evidence locker',
  'impersonating a donut inspector',
  'excessive use of caps lock',
  'parking a patrol car on the sidewalk',
  'operating a meme without a license',
  'loitering in the #general channel',
  'reckless pinging in the third degree',
  'possession of an unregistered emoji',
];

/** Deterministic crime for a seed (so /wanted is stable per target). */
export function pickCrime(seed) {
  return pick(CRIMES, `crime:${seed}`);
}

/** Deterministic bounty in donuts, 100–5000, rounded to the nearest 50. */
export function pickBounty(seed) {
  const raw = 100 + (hashSeed(`bounty:${seed}`) % 4901);
  return Math.round(raw / 50) * 50;
}

// The WANTED poster itself is rendered as an image in lib/poster.js.

// --- /donut ------------------------------------------------------------------

const DONUTS = [
  'a classic glazed 🍩',
  'a chocolate frosted with sprinkles 🍩',
  'a strawberry jelly-filled 🍩',
  'a maple bar 🍩',
  'a Boston cream 🍩',
  'a cinnamon sugar old-fashioned 🍩',
  'a rainbow-sprinkled birthday-cake 🍩',
  'the last donut in the break room 🍩',
];

/** Deterministic donut for a seed. */
export function pickDonut(seed) {
  return pick(DONUTS, `donut:${seed}`);
}

// --- /911 --------------------------------------------------------------------

/**
 * @param {{ targetLabel, targetId?:string|null, reason?:string|null,
 *           reporterLabel:string, anonymous:boolean }} data
 * @returns {object} APIEmbed
 */
export function reportEmbed({ targetLabel, targetId = null, reason = null, reporterLabel, anonymous }) {
  return {
    title: '🚨 911 — Citizen Report',
    color: 0xcc3a3a,
    description: `**Reported:** ${targetLabel}${targetId ? ` (${targetId})` : ''}`,
    fields: [
      { name: 'Reason', value: reason?.trim() ? reason : 'No reason given' },
      { name: 'Reporter', value: anonymous ? '_Anonymous_' : reporterLabel, inline: true },
    ],
  };
}
