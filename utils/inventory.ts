import { ActionStep } from '../action_tree/types';

/**
 * Inventory manipulation utilities
 */

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
 * Gets the total count of a specific item in the bot's inventory
 * 
 * @param bot - Mineflayer bot instance
 * @param itemName - Name of the item to count
 * @returns Total count of the item
 * 
 * @example
 * getItemCountInInventory(bot, 'oak_log') // returns total oak logs in inventory
 */
export function getItemCountInInventory(bot: any, itemName: string): number {
  try {
    const items = bot.inventory?.items?.() || [];
    return items
      .filter((item: any) => item && item.name === itemName)
      .reduce((total: number, item: any) => total + (item.count || 0), 0);
  } catch (_) {
    return 0;
  }
}

