import { ActionStep } from '../action_tree/types';

/**
 * Inventory manipulation utilities
 */

// Equipment slot indices: head:5, torso:6, legs:7, feet:8, offhand:45
const EQUIPMENT_SLOTS = [5, 6, 7, 8, 45];

export type InventoryObject = Record<string, number>;

/**
 * Converts an inventory object to a Map
 * 
 * @param inv - Inventory object with item counts
 * @returns Map of item name to count
 */
export function makeSupplyFromInventory(inv: Record<string, any> | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!inv) return m;

  for (const [k, v] of Object.entries(inv)) {
    const n = Number(v);
    if (!Number.isNaN(n) && n > 0) {
      m.set(k, n);
    }
  }

  return m;
}

/**
 * Converts an inventory Map to an object
 * 
 * @param map - Map of item name to count
 * @returns Plain object with item counts
 */
export function mapToInventoryObject(map: Map<string, number> | null | undefined): Record<string, number> {
  const o: Record<string, number> = {};
  if (!map) return o;

  for (const [k, v] of map.entries()) {
    if (v > 0) {
      o[k] = v;
    }
  }

  return o;
}

/**
 * Determines what item is produced by an action step
 * 
 * @param step - Action step to analyze
 * @returns Item name produced, or null if none
 * 
 * @example
 * produced({ action: 'craft', result: { item: 'stick' } }) // returns 'stick'
 * produced({ action: 'mine', what: 'oak_log' }) // returns 'oak_log'
 */
export function produced(step: ActionStep | null | undefined): string | null {
  if (!step) return null;

  if (step.action === 'craft' && 'result' in step) {
    const result = (step as any).result;
    if (result && result.item) return result.item;
  }

  if (step.action === 'smelt' && 'result' in step) {
    const result = (step as any).result;
    if (result && result.item) return result.item;
  }

  if ((step.action === 'mine' || step.action === 'hunt')) {
    const targetItem = 'targetItem' in step ? (step as any).targetItem : null;
    return targetItem || step.what;
  }

  return null;
}

/**
 * Gets the full inventory as an object mapping item names to counts.
 * Includes regular inventory, armor slots, and offhand.
 * 
 * @param bot - Mineflayer bot instance
 * @returns Object mapping item names to total counts
 */
export function getInventoryObject(bot: any): InventoryObject {
  const out: InventoryObject = {};
  try {
    const items = bot.inventory?.items() || [];
    for (const it of items) {
      if (!it || !it.name || !Number.isFinite(it.count)) continue;
      out[it.name] = (out[it.name] || 0) + it.count;
    }
    
    const slots = bot.inventory?.slots;
    if (Array.isArray(slots)) {
      for (const slotIndex of EQUIPMENT_SLOTS) {
        const item = slots[slotIndex];
        if (item && item.name) {
          out[item.name] = (out[item.name] || 0) + (item.count || 1);
        }
      }
    }
  } catch (_) {}
  return out;
}

/**
 * Gets the total count of a specific item in the bot's inventory and equipment slots
 * 
 * @param bot - Mineflayer bot instance
 * @param itemName - Name of the item to count
 * @returns Total count of the item
 * 
 * @example
 * getItemCountInInventory(bot, 'oak_log') // returns total oak logs in inventory
 * getItemCountInInventory(bot, 'diamond_chestplate') // includes equipped armor
 * getItemCountInInventory(bot, 'shield') // includes shield in offhand
 */
export function getItemCountInInventory(bot: any, itemName: string): number {
  try {
    const items = bot.inventory?.items?.() || [];
    let total = items
      .filter((item: any) => item && item.name === itemName)
      .reduce((sum: number, item: any) => sum + (item.count || 0), 0);
    
    const slots = bot.inventory?.slots;
    if (Array.isArray(slots)) {
      for (const slotIndex of EQUIPMENT_SLOTS) {
        const item = slots[slotIndex];
        if (item && item.name === itemName) {
          total += item.count || 1;
        }
      }
    }
    
    return total;
  } catch (_) {
    return 0;
  }
}

