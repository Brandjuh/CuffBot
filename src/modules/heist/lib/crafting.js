// Heist crafting (S85 = M16.12 slice A): the pure half of the cog's craft
// flow — check the materials, spend them, hand over the enhanced item. The
// command surface (slice B) owns the buttons and the store write.
import { ITEMS, RECIPES } from './tables.js';

/**
 * @returns {{ok:true, inventory:object, result:string, quantity:number}
 *         | {ok:false, error:'unknown-recipe'} | {ok:false, error:'missing', missing:object}}
 */
export function craftPlan(inventory, recipeName) {
  const recipe = RECIPES[recipeName];
  if (!recipe) return { ok: false, error: 'unknown-recipe' };

  const missing = {};
  for (const [material, needed] of Object.entries(recipe.materials)) {
    const short = needed - (inventory[material] ?? 0);
    if (short > 0) missing[material] = short;
  }
  if (Object.keys(missing).length > 0) return { ok: false, error: 'missing', missing };

  const next = { ...inventory };
  for (const [material, needed] of Object.entries(recipe.materials)) {
    const left = next[material] - needed;
    if (left <= 0) delete next[material];
    else next[material] = left;
  }
  next[recipe.result] = (next[recipe.result] ?? 0) + recipe.quantity;
  return { ok: true, inventory: next, result: recipe.result, quantity: recipe.quantity };
}

/** Recipes an inventory can afford right now (for the craft menu). */
export function craftableFrom(inventory) {
  return Object.keys(RECIPES).filter((name) => craftPlan(inventory, name).ok);
}

/** The sell value range of an item, or null when it isn't sellable. */
export function sellRange(itemId) {
  const item = ITEMS[itemId];
  if (!item || (item.type !== 'loot' && item.type !== 'material')) return null;
  return { min: item.minSell, max: item.maxSell };
}
