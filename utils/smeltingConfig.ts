import { MinecraftData } from '../action_tree/types';

/**
 * Centralized smelting mappings and fuel characteristics
 */

/**
 * Map output item -> array of valid input items for furnace smelting
 */
const FURNACE_INPUTS: Record<string, string[]> = {
  // Ores and materials
  iron_ingot: ['raw_iron'],
  gold_ingot: ['raw_gold'],
  copper_ingot: ['raw_copper'],
  stone: ['cobblestone'],
  
  // Cooked meats
  cooked_beef: ['beef'],
  cooked_porkchop: ['porkchop'],
  cooked_mutton: ['mutton'],
  cooked_chicken: ['chicken'],
  cooked_rabbit: ['rabbit'],
  
  // Cooked fish
  cooked_salmon: ['salmon'],
  cooked_cod: ['cod'],
  
  // Other food
  baked_potato: ['potato'],
  dried_kelp: ['kelp']
};

/**
 * Fuel configuration: itemName -> smeltsPerUnit (Java baseline)
 */
const FUEL_SMELTS_PER_UNIT: Record<string, number> = {
  coal: 8
  // charcoal: 8,
  // blaze_rod: 12,
  // stick: 0.5,
  // bamboo: 0.25,
};

/**
 * Gets valid furnace input items for a given output item
 * 
 * @param outputItemName - The item that will be smelted (e.g., 'iron_ingot')
 * @returns Array of valid input items (e.g., ['raw_iron', 'iron_ore'])
 */
export function getFurnaceInputsFor(outputItemName: string): string[] {
  return FURNACE_INPUTS[outputItemName] || [];
}

/**
 * Chooses the minimal fuel type for smelting
 * 
 * Currently prefers coal if available
 * 
 * @param mcData - Minecraft data instance
 * @returns Fuel item name, or null if no fuel available
 */
export function chooseMinimalFuelName(mcData: MinecraftData): string | null {
  // For now, prefer coal if available; else return null to avoid fuel branch
  return mcData.itemsByName['coal'] ? 'coal' : null;
}

/**
 * Gets the number of items that can be smelted per unit of fuel
 * 
 * @param fuelName - Fuel item name (e.g., 'coal')
 * @returns Number of smelt operations per unit of this fuel
 */
export function getSmeltsPerUnitForFuel(fuelName: string): number {
  return FUEL_SMELTS_PER_UNIT[fuelName] || 0;
}

