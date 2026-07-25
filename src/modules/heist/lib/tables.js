// Heist data tables (S85 = M16.12 slice A, ported from maxcogs/heist utils.py).
// Transcribed VERBATIM — every number, emoji and relationship matches the cog;
// the transcription is machine-checked against the Python source by
// scripts/verify-heist-tables.mjs (see the module manual). Python timedeltas
// become milliseconds; snake_case keys become camelCase. No discord.js here.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Every purchasable, lootable and craftable item.
 * type 'shield'   → { cost?, reduction, durationHours }   (crafted ones have no cost)
 * type 'tool'     → { cost?, boost, forHeist }
 * type 'loot'     → { minSell, maxSell }
 * type 'material' → { minSell, maxSell }
 */
export const ITEMS = {
  wooden_shield: { emoji: '🛡️', type: 'shield', cost: 3000, reduction: 0.03, durationHours: 24 },
  iron_shield: { emoji: '🛡️', type: 'shield', cost: 7000, reduction: 0.05, durationHours: 36 },
  steel_shield: { emoji: '🛡️', type: 'shield', cost: 12000, reduction: 0.07, durationHours: 48 },
  titanium_shield: { emoji: '🛡️', type: 'shield', cost: 20000, reduction: 0.09, durationHours: 60 },
  diamond_shield: { emoji: '🛡️', type: 'shield', cost: 35000, reduction: 0.12, durationHours: 72 },
  full: { emoji: '🛡️', type: 'shield', cost: 100000, reduction: 1.0, durationHours: 96 },

  bike_tool: { emoji: '🔧', type: 'tool', cost: 500, boost: 0.1, forHeist: 'street_bike' },
  car_tool: { emoji: '🔓', type: 'tool', cost: 1000, boost: 0.15, forHeist: 'street_car' },
  motorcycle_tool: { emoji: '🛠️', type: 'tool', cost: 800, boost: 0.12, forHeist: 'street_motorcycle' },
  pickpocket_gloves: { emoji: '🧤', type: 'tool', cost: 200, boost: 0.05, forHeist: 'pocket_steal' },
  crowbar: { emoji: '🪓', type: 'tool', cost: 300, boost: 0.07, forHeist: 'atm_smash' },
  glass_cutter: { emoji: '🔪', type: 'tool', cost: 600, boost: 0.10, forHeist: 'jewelry_store' },
  brass_knuckles: { emoji: '🥊', type: 'tool', cost: 800, boost: 0.12, forHeist: 'fight_club' },
  laser_jammer: { emoji: '📡', type: 'tool', cost: 1500, boost: 0.15, forHeist: 'art_gallery' },
  hacking_device: { emoji: '💾', type: 'tool', cost: 2500, boost: 0.15, forHeist: 'casino_vault' },
  store_key: { emoji: '🔑', type: 'tool', cost: 400, boost: 0.08, forHeist: 'store_robbery' },
  lockpick_kit: { emoji: '🗝️', type: 'tool', cost: 1800, boost: 0.14, forHeist: 'museum_relic' },
  grappling_hook: { emoji: '🪝', type: 'tool', cost: 2000, boost: 0.15, forHeist: 'luxury_yacht' },

  street_bike: { emoji: '🚲', type: 'loot', minSell: 1500, maxSell: 3500 },
  street_car: { emoji: '🚗', type: 'loot', minSell: 20000, maxSell: 30000 },
  street_motorcycle: { emoji: '🏍️', type: 'loot', minSell: 8000, maxSell: 12000 },
  pocket_loot: { emoji: '💰', type: 'loot', minSell: 100, maxSell: 500 },
  jewelry: { emoji: '💍', type: 'loot', minSell: 5000, maxSell: 15000 },
  painting: { emoji: '🖼️', type: 'loot', minSell: 20000, maxSell: 80000 },
  relic: { emoji: '🏺', type: 'loot', minSell: 30000, maxSell: 120000 },
  yacht_loot: { emoji: '🛥️', type: 'loot', minSell: 40000, maxSell: 150000 },

  scrap_metal: { emoji: '🧱', type: 'material', minSell: 100, maxSell: 300 },
  tech_parts: { emoji: '🔩', type: 'material', minSell: 200, maxSell: 500 },
  rare_alloy: { emoji: '🪙', type: 'material', minSell: 500, maxSell: 1000 },

  reinforced_wooden_shield: { emoji: '🛡️', type: 'shield', reduction: 0.05, durationHours: 24 },
  enhanced_pickpocket_gloves: { emoji: '🧤', type: 'tool', boost: 0.08, forHeist: 'pocket_steal' },
  reinforced_iron_shield: { emoji: '🛡️', type: 'shield', reduction: 0.07, durationHours: 36 },
  reinforced_steel_shield: { emoji: '🛡️', type: 'shield', reduction: 0.09, durationHours: 48 },
  reinforced_titanium_shield: { emoji: '🛡️', type: 'shield', reduction: 0.11, durationHours: 60 },
  reinforced_diamond_shield: { emoji: '🛡️', type: 'shield', reduction: 0.15, durationHours: 72 },
  enhanced_crowbar: { emoji: '🪓', type: 'tool', boost: 0.10, forHeist: 'atm_smash' },
  enhanced_glass_cutter: { emoji: '🔪', type: 'tool', boost: 0.13, forHeist: 'jewelry_store' },
  enhanced_brass_knuckles: { emoji: '🥊', type: 'tool', boost: 0.15, forHeist: 'fight_club' },
  enhanced_laser_jammer: { emoji: '📡', type: 'tool', boost: 0.18, forHeist: 'art_gallery' },
  enhanced_hacking_device: { emoji: '💾', type: 'tool', boost: 0.18, forHeist: 'casino_vault' },
  enhanced_store_key: { emoji: '🔑', type: 'tool', boost: 0.11, forHeist: 'store_robbery' },
  enhanced_lockpick_kit: { emoji: '🗝️', type: 'tool', boost: 0.17, forHeist: 'museum_relic' },
  enhanced_grappling_hook: { emoji: '🪝', type: 'tool', boost: 0.18, forHeist: 'luxury_yacht' },
  enhanced_bike_tool: { emoji: '🔧', type: 'tool', boost: 0.13, forHeist: 'street_bike' },
  enhanced_car_tool: { emoji: '🔓', type: 'tool', boost: 0.18, forHeist: 'street_car' },
  enhanced_motorcycle_tool: { emoji: '🛠️', type: 'tool', boost: 0.15, forHeist: 'street_motorcycle' },

  coin_hook: { emoji: '🪝', type: 'tool', cost: 150, boost: 0.08, forHeist: 'vending_machine' },
  parking_slim_jim: { emoji: '🔩', type: 'tool', cost: 250, boost: 0.10, forHeist: 'parking_meter' },
  distraction_device: { emoji: '📦', type: 'tool', cost: 700, boost: 0.12, forHeist: 'food_truck' },
  pharmacy_mask: { emoji: '😷', type: 'tool', cost: 2000, boost: 0.14, forHeist: 'hospital_pharmacy' },
  trading_terminal: { emoji: '💻', type: 'tool', cost: 4000, boost: 0.15, forHeist: 'stock_exchange' },
  gold_drill: { emoji: '⛏️', type: 'tool', cost: 8000, boost: 0.16, forHeist: 'gold_reserve' },
  military_keycard: { emoji: '🪪', type: 'tool', cost: 15000, boost: 0.18, forHeist: 'military_depot' },
  space_suit: { emoji: '👨‍🚀', type: 'tool', cost: 25000, boost: 0.20, forHeist: 'space_agency' },
  corporate_badge: { emoji: '🏷️', type: 'tool', cost: 3500, boost: 0.14, forHeist: 'corporate' },
  bank_drill: { emoji: '🔨', type: 'tool', cost: 12000, boost: 0.16, forHeist: 'bank' },
  elite_kit: { emoji: '🧰', type: 'tool', cost: 40000, boost: 0.18, forHeist: 'elite' },

  enhanced_coin_hook: { emoji: '🪝', type: 'tool', boost: 0.12, forHeist: 'vending_machine' },
  enhanced_parking_slim_jim: { emoji: '🔩', type: 'tool', boost: 0.14, forHeist: 'parking_meter' },
  enhanced_distraction_device: { emoji: '📦', type: 'tool', boost: 0.16, forHeist: 'food_truck' },
  enhanced_pharmacy_mask: { emoji: '😷', type: 'tool', boost: 0.18, forHeist: 'hospital_pharmacy' },
  enhanced_trading_terminal: { emoji: '💻', type: 'tool', boost: 0.20, forHeist: 'stock_exchange' },
  enhanced_gold_drill: { emoji: '⛏️', type: 'tool', boost: 0.22, forHeist: 'gold_reserve' },
  enhanced_military_keycard: { emoji: '🪪', type: 'tool', boost: 0.24, forHeist: 'military_depot' },
  enhanced_space_suit: { emoji: '👨‍🚀', type: 'tool', boost: 0.26, forHeist: 'space_agency' },
  enhanced_corporate_badge: { emoji: '🏷️', type: 'tool', boost: 0.18, forHeist: 'corporate' },
  enhanced_bank_drill: { emoji: '🔨', type: 'tool', boost: 0.22, forHeist: 'bank' },
  enhanced_elite_kit: { emoji: '🧰', type: 'tool', boost: 0.25, forHeist: 'elite' },

  classified_docs: { emoji: '📄', type: 'material', minSell: 1000, maxSell: 3000 },
  military_grade_alloy: { emoji: '🪨', type: 'material', minSell: 2000, maxSell: 5000 },
  gold_bar: { emoji: '🏅', type: 'loot', minSell: 50000, maxSell: 200000 },
  satellite_component: { emoji: '🛰️', type: 'loot', minSell: 100000, maxSell: 400000 },
  medical_supplies: { emoji: '💊', type: 'loot', minSell: 3000, maxSell: 12000 },
  stock_data: { emoji: '📊', type: 'loot', minSell: 10000, maxSell: 50000 },
};

/** Craft recipes: materials → one enhanced tool or reinforced shield. */
export const RECIPES = {
  reinforced_wooden_shield: { materials: { scrap_metal: 5 }, result: 'reinforced_wooden_shield', quantity: 1 },
  enhanced_pickpocket_gloves: { materials: { tech_parts: 3 }, result: 'enhanced_pickpocket_gloves', quantity: 1 },
  reinforced_iron_shield: { materials: { scrap_metal: 7, rare_alloy: 2 }, result: 'reinforced_iron_shield', quantity: 1 },
  reinforced_steel_shield: { materials: { scrap_metal: 10, rare_alloy: 3 }, result: 'reinforced_steel_shield', quantity: 1 },
  reinforced_titanium_shield: { materials: { scrap_metal: 12, rare_alloy: 4 }, result: 'reinforced_titanium_shield', quantity: 1 },
  reinforced_diamond_shield: { materials: { scrap_metal: 15, rare_alloy: 5 }, result: 'reinforced_diamond_shield', quantity: 1 },
  enhanced_crowbar: { materials: { scrap_metal: 4, tech_parts: 2 }, result: 'enhanced_crowbar', quantity: 1 },
  enhanced_glass_cutter: { materials: { tech_parts: 4, rare_alloy: 1 }, result: 'enhanced_glass_cutter', quantity: 1 },
  enhanced_brass_knuckles: { materials: { scrap_metal: 5, tech_parts: 2 }, result: 'enhanced_brass_knuckles', quantity: 1 },
  enhanced_laser_jammer: { materials: { tech_parts: 5, rare_alloy: 2 }, result: 'enhanced_laser_jammer', quantity: 1 },
  enhanced_hacking_device: { materials: { tech_parts: 6, rare_alloy: 3 }, result: 'enhanced_hacking_device', quantity: 1 },
  enhanced_store_key: { materials: { scrap_metal: 3, tech_parts: 2 }, result: 'enhanced_store_key', quantity: 1 },
  enhanced_lockpick_kit: { materials: { tech_parts: 5, rare_alloy: 2 }, result: 'enhanced_lockpick_kit', quantity: 1 },
  enhanced_grappling_hook: { materials: { scrap_metal: 6, rare_alloy: 3 }, result: 'enhanced_grappling_hook', quantity: 1 },
  enhanced_bike_tool: { materials: { scrap_metal: 3, tech_parts: 1 }, result: 'enhanced_bike_tool', quantity: 1 },
  enhanced_car_tool: { materials: { scrap_metal: 5, tech_parts: 3 }, result: 'enhanced_car_tool', quantity: 1 },
  enhanced_motorcycle_tool: { materials: { scrap_metal: 4, tech_parts: 2 }, result: 'enhanced_motorcycle_tool', quantity: 1 },
  enhanced_coin_hook: { materials: { scrap_metal: 2, tech_parts: 1 }, result: 'enhanced_coin_hook', quantity: 1 },
  enhanced_parking_slim_jim: { materials: { scrap_metal: 3, tech_parts: 1 }, result: 'enhanced_parking_slim_jim', quantity: 1 },
  enhanced_distraction_device: { materials: { tech_parts: 3, scrap_metal: 2 }, result: 'enhanced_distraction_device', quantity: 1 },
  enhanced_pharmacy_mask: { materials: { tech_parts: 4, rare_alloy: 1 }, result: 'enhanced_pharmacy_mask', quantity: 1 },
  enhanced_trading_terminal: { materials: { tech_parts: 5, rare_alloy: 2 }, result: 'enhanced_trading_terminal', quantity: 1 },
  enhanced_gold_drill: { materials: { rare_alloy: 4, military_grade_alloy: 1 }, result: 'enhanced_gold_drill', quantity: 1 },
  enhanced_military_keycard: { materials: { classified_docs: 2, military_grade_alloy: 2 }, result: 'enhanced_military_keycard', quantity: 1 },
  enhanced_space_suit: { materials: { classified_docs: 3, military_grade_alloy: 3 }, result: 'enhanced_space_suit', quantity: 1 },
  enhanced_corporate_badge: { materials: { tech_parts: 4, rare_alloy: 2 }, result: 'enhanced_corporate_badge', quantity: 1 },
  enhanced_bank_drill: { materials: { rare_alloy: 3, military_grade_alloy: 2 }, result: 'enhanced_bank_drill', quantity: 1 },
  enhanced_elite_kit: { materials: { rare_alloy: 5, military_grade_alloy: 3, classified_docs: 2 }, result: 'enhanced_elite_kit', quantity: 1 },
};

/**
 * The jobs. `cooldownMs`/`durationMs`/`jailMs` are the cog's timedeltas in
 * milliseconds. `risk` is carried for the shop/UI copy only — the resolver
 * uses minSuccess/maxSuccess (the cog does the same). `materialTiers`
 * restricts the drop pool for the three end-game jobs.
 */
export const HEISTS = {
  pocket_steal: {
    emoji: '🕶️', risk: 0.01, minReward: 0, maxReward: 300, cooldownMs: 30 * MINUTE,
    minSuccess: 70, maxSuccess: 80, durationMs: 2 * MINUTE, minLoss: 100, maxLoss: 300,
    policeChance: 0.05, jailMs: 1 * HOUR, materialDropChance: 0.2, xpReward: 15,
  },
  atm_smash: {
    emoji: '🏧', risk: 0.04, minReward: 500, maxReward: 3000, cooldownMs: 45 * MINUTE,
    minSuccess: 40, maxSuccess: 65, durationMs: 3 * MINUTE, minLoss: 300, maxLoss: 1500,
    policeChance: 0.05, jailMs: 2 * HOUR, materialDropChance: 0.25, xpReward: 30,
  },
  store_robbery: {
    emoji: '🏬', risk: 0.05, minReward: 1000, maxReward: 5000, cooldownMs: 1 * HOUR,
    minSuccess: 50, maxSuccess: 60, durationMs: 5 * MINUTE, minLoss: 500, maxLoss: 2000,
    policeChance: 0.15, jailMs: 3 * HOUR, materialDropChance: 0.3, xpReward: 40,
  },
  jewelry_store: {
    emoji: '💎', risk: 0.07, minReward: 3000, maxReward: 12000, cooldownMs: 2 * HOUR,
    minSuccess: 25, maxSuccess: 55, durationMs: 6 * MINUTE, minLoss: 2000, maxLoss: 7000,
    policeChance: 0.2, jailMs: 4 * HOUR, materialDropChance: 0.35, xpReward: 60,
  },
  fight_club: {
    emoji: '🥊', risk: 0.10, minReward: 10000, maxReward: 40000, cooldownMs: 3 * HOUR,
    minSuccess: 20, maxSuccess: 50, durationMs: 8 * MINUTE, minLoss: 5000, maxLoss: 15000,
    policeChance: 0.25, jailMs: 5 * HOUR, materialDropChance: 0.4, xpReward: 75,
  },
  art_gallery: {
    emoji: '🖼️', risk: 0.15, minReward: 1000, maxReward: 6000, cooldownMs: 4 * HOUR,
    minSuccess: 15, maxSuccess: 45, durationMs: 12 * MINUTE, minLoss: 10000, maxLoss: 30000,
    policeChance: 0.3, jailMs: 6 * HOUR, materialDropChance: 0.45, xpReward: 90,
  },
  casino_vault: {
    emoji: '🎰', risk: 0.20, minReward: 50000, maxReward: 200000, cooldownMs: 5 * HOUR,
    minSuccess: 10, maxSuccess: 40, durationMs: 15 * MINUTE, minLoss: 20000, maxLoss: 100000,
    policeChance: 0.35, jailMs: 8 * HOUR, materialDropChance: 0.5, xpReward: 120,
  },
  museum_relic: {
    emoji: '🏺', risk: 0.18, minReward: 10000, maxReward: 50000, cooldownMs: 4 * HOUR,
    minSuccess: 12, maxSuccess: 42, durationMs: 14 * MINUTE, minLoss: 15000, maxLoss: 60000,
    policeChance: 0.4, jailMs: 12 * HOUR, materialDropChance: 0.55, xpReward: 120,
  },
  luxury_yacht: {
    emoji: '🛥️', risk: 0.17, minReward: 10000, maxReward: 80000, cooldownMs: 4 * HOUR,
    minSuccess: 13, maxSuccess: 43, durationMs: 13 * MINUTE, minLoss: 15000, maxLoss: 70000,
    policeChance: 0.45, jailMs: 24 * HOUR, materialDropChance: 0.6, xpReward: 120,
  },
  street_bike: {
    emoji: '🚲', risk: 0.03, minReward: 0, maxReward: 0, cooldownMs: 1 * HOUR,
    minSuccess: 20, maxSuccess: 60, durationMs: 3 * MINUTE, minLoss: 500, maxLoss: 2000,
    policeChance: 0.1, jailMs: 2 * HOUR, materialDropChance: 0.15, xpReward: 25,
  },
  street_motorcycle: {
    emoji: '🏍️', risk: 0.05, minReward: 0, maxReward: 0, cooldownMs: 2 * HOUR,
    minSuccess: 15, maxSuccess: 50, durationMs: 5 * MINUTE, minLoss: 2000, maxLoss: 8000,
    policeChance: 0.15, jailMs: 3 * HOUR, materialDropChance: 0.2, xpReward: 35,
  },
  street_car: {
    emoji: '🚗', risk: 0.08, minReward: 100, maxReward: 5000, cooldownMs: 3 * HOUR,
    minSuccess: 10, maxSuccess: 40, durationMs: 8 * MINUTE, minLoss: 8000, maxLoss: 20000,
    policeChance: 0.2, jailMs: 4 * HOUR, materialDropChance: 0.25, xpReward: 50,
  },
  corporate: {
    emoji: '🏢', risk: 0.12, minReward: 25000, maxReward: 100000, cooldownMs: 4 * HOUR,
    minSuccess: 10, maxSuccess: 50, durationMs: 10 * MINUTE, minLoss: 10000, maxLoss: 50000,
    policeChance: 0.3, jailMs: 8 * HOUR, materialDropChance: 0.35, xpReward: 100,
  },
  bank: {
    emoji: '🏦', risk: 0.25, minReward: 100000, maxReward: 500000, cooldownMs: 6 * HOUR,
    minSuccess: 5, maxSuccess: 40, durationMs: 15 * MINUTE, minLoss: 50000, maxLoss: 250000,
    policeChance: 0.35, jailMs: 12 * HOUR, materialDropChance: 0.45, xpReward: 160,
  },
  elite: {
    emoji: '💎', risk: 0.35, minReward: 500000, maxReward: 1000000, cooldownMs: 8 * HOUR,
    minSuccess: 5, maxSuccess: 30, durationMs: 20 * MINUTE, minLoss: 250000, maxLoss: 500000,
    policeChance: 0.4, jailMs: 12 * HOUR, materialDropChance: 0.5, xpReward: 200,
  },
  crew_robbery: {
    emoji: '👥', risk: 0.30, minReward: 1000000, maxReward: 80000000, cooldownMs: 8 * HOUR,
    minSuccess: 8, maxSuccess: 35, durationMs: 20 * MINUTE, minLoss: 80000, maxLoss: 300000,
    policeChance: 0.45, jailMs: 16 * HOUR, materialDropChance: 0.6, xpReward: 300, crewSize: 4,
  },
  vending_machine: {
    emoji: '🥤', risk: 0.005, minReward: 10, maxReward: 80, cooldownMs: 10 * MINUTE,
    minSuccess: 80, maxSuccess: 95, durationMs: 30_000, minLoss: 5, maxLoss: 30,
    policeChance: 0.01, jailMs: 15 * MINUTE, materialDropChance: 0.05, xpReward: 9,
  },
  parking_meter: {
    emoji: '🅿️', risk: 0.01, minReward: 50, maxReward: 200, cooldownMs: 20 * MINUTE,
    minSuccess: 60, maxSuccess: 85, durationMs: 1 * MINUTE, minLoss: 20, maxLoss: 100,
    policeChance: 0.03, jailMs: 30 * MINUTE, materialDropChance: 0.08, xpReward: 8,
  },
  food_truck: {
    emoji: '🚚', risk: 0.03, minReward: 300, maxReward: 1200, cooldownMs: 40 * MINUTE,
    minSuccess: 45, maxSuccess: 70, durationMs: 3 * MINUTE, minLoss: 150, maxLoss: 600,
    policeChance: 0.06, jailMs: 1 * HOUR, materialDropChance: 0.15, xpReward: 20,
  },
  hospital_pharmacy: {
    emoji: '🏥', risk: 0.08, minReward: 0, maxReward: 9000, cooldownMs: 2 * HOUR,
    minSuccess: 20, maxSuccess: 50, durationMs: 7 * MINUTE, minLoss: 3000, maxLoss: 10000,
    policeChance: 0.18, jailMs: 4 * HOUR, materialDropChance: 0.3, xpReward: 50,
  },
  stock_exchange: {
    emoji: '📈', risk: 0.12, minReward: 10, maxReward: 4000, cooldownMs: 3 * HOUR,
    minSuccess: 12, maxSuccess: 45, durationMs: 10 * MINUTE, minLoss: 8000, maxLoss: 30000,
    policeChance: 0.22, jailMs: 6 * HOUR, materialDropChance: 0.35, xpReward: 85,
  },
  gold_reserve: {
    emoji: '🪙', risk: 0.22, minReward: 3000000, maxReward: 4000000, cooldownMs: 6 * HOUR,
    minSuccess: 6, maxSuccess: 28, durationMs: 18 * MINUTE, minLoss: 40000, maxLoss: 180000,
    policeChance: 0.38, jailMs: 10 * HOUR, materialDropChance: 0.45, xpReward: 130,
    materialTiers: ['scrap_metal', 'tech_parts', 'rare_alloy', 'military_grade_alloy'],
  },
  military_depot: {
    emoji: '🪖', risk: 0.28, minReward: 120000, maxReward: 500000, cooldownMs: 7 * HOUR,
    minSuccess: 8, maxSuccess: 30, durationMs: 18 * MINUTE, minLoss: 60000, maxLoss: 220000,
    policeChance: 0.42, jailMs: 14 * HOUR, materialDropChance: 0.5, xpReward: 150,
    materialTiers: ['rare_alloy', 'classified_docs', 'military_grade_alloy'],
  },
  space_agency: {
    emoji: '🚀', risk: 0.38, minReward: 100000, maxReward: 200000, cooldownMs: 10 * HOUR,
    minSuccess: 5, maxSuccess: 22, durationMs: 25 * MINUTE, minLoss: 300000, maxLoss: 700000,
    policeChance: 0.5, jailMs: 24 * HOUR, materialDropChance: 0.55, xpReward: 220,
    materialTiers: ['rare_alloy', 'classified_docs', 'military_grade_alloy'],
  },
};

/** Every material item id (the default drop pool when a job names no tiers). */
export const MATERIAL_ITEMS = Object.entries(ITEMS)
  .filter(([, item]) => item.type === 'material')
  .map(([id]) => id);

/** The cog's `fmt`: snake_case → Title Case for display. */
export function fmt(id) {
  return id
    .replaceAll('_', ' ')
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}
