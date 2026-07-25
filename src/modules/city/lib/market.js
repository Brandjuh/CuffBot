// The city black market (S92 = M16.13 slice D, ported from
// CalaMari-Cogs/city crime/blackmarket.py). Pure data + the pure half of the
// perk rules; the buying and spending live in the service.
//
// RECORDED DEVIATION: the cog's third item, `notify_ping` (a 10,000-credit
// perk that pings you when your sentence ends), is NOT sold here. Our jail
// has no release timer at all — a sentence is evaluated lazily whenever the
// member acts — so the perk would take money for nothing. If a release
// scheduler is ever added (the heist module has the pattern), sell it then.
export const MARKET_ITEMS = {
  jail_reducer: {
    name: 'Reduced Sentence',
    description: 'Permanently serve 20% less time.',
    cost: 20_000,
    type: 'perk',
    emoji: '⚖️',
  },
  jail_pass: {
    name: 'Get Out of Jail Free',
    description: 'One card, one instant walk out of a cell.',
    cost: 1000,
    type: 'consumable',
    emoji: '🔑',
    uses: 1,
  },
};

/** The cog's apply_sentence_reduction: the perk shaves 20% off a sentence. */
export function applySentenceReduction(jailMs, perks = []) {
  return perks.includes('jail_reducer') ? Math.trunc(jailMs * 0.8) : jailMs;
}

export const isPerk = (itemId) => MARKET_ITEMS[itemId]?.type === 'perk';
export const isConsumable = (itemId) => MARKET_ITEMS[itemId]?.type === 'consumable';
