import { getLastMcData } from './context';
import { getSuffixTokenFromName } from './items';

/**
 * Utilities for identifying persistent items (tools, crafting tables, furnaces)
 * that should be reused rather than consumed
 */

/**
 * Builds a set of all persistent item names from minecraft data
 * 
 * Persistent items include:
 * - Crafting tables and furnaces
 * - All harvest tools (pickaxes, axes, shovels, hoes, swords, shears)
 * 
 * @returns Set of persistent item names
 */
export function buildPersistentNamesSet(): Set<string> {
  const s = new Set<string>(['crafting_table', 'furnace']);
  const lastMcData = getLastMcData();

  if (lastMcData) {
    try {
      // Add all harvest tools from block data
      Object.values(lastMcData.blocks || {}).forEach((b: any) => {
        if (b && b.harvestTools) {
          Object.keys(b.harvestTools).forEach((id: string) => {
            const items = lastMcData.items as any;
            const nm = items[id]?.name || String(id);
            if (nm) s.add(nm);
          });
        }
      });

      // Add all tool types by suffix
      const toolSuffixes = new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']);
      Object.keys(lastMcData.itemsByName || {}).forEach((n: string) => {
        const base = getSuffixTokenFromName(n);
        if (toolSuffixes.has(base)) s.add(n);
      });
    } catch (_) {
      // Ignore errors in building set
    }
  }

  return s;
}

/**
 * Checks if an item name is persistent (should not be consumed)
 * 
 * @param name - Item name to check
 * @param set - Optional pre-built set of persistent names (for performance)
 * @returns true if the item is persistent
 * 
 * @example
 * isPersistentItemName('wooden_pickaxe') // returns true
 * isPersistentItemName('cobblestone') // returns false
 */
export function isPersistentItemName(name: string, set?: Set<string>): boolean {
  return !!name && (set ? set.has(name) : buildPersistentNamesSet().has(name));
}

