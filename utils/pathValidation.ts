import { ActionPath, ActionStep } from '../action_tree/types';

/**
 * Options for path simulation
 */
export interface SimulatePathOptions {
  initialSupply?: Map<string, number> | any;
  getSmeltsPerUnitForFuel?: (fuelName: string) => number;
  requireStations?: boolean;
}

/**
 * Simulates executing a path to check if it's valid
 * 
 * Tracks inventory changes step-by-step to verify:
 * - Required ingredients are available when needed
 * - Crafting tables/furnaces are present for crafting/smelting
 * - Fuel is available for smelting
 * 
 * @param path - Action path to simulate
 * @param options - Simulation options (initial supply, fuel function, station requirements)
 * @returns true if the path can be executed successfully
 */
export function simulatePath(path: ActionPath, options?: SimulatePathOptions): boolean {
  const initialSupply = options && options.initialSupply instanceof Map 
    ? options.initialSupply 
    : new Map(options && options.initialSupply ? options.initialSupply : []);
  
  const getSmeltsPerUnitForFuel = options && typeof options.getSmeltsPerUnitForFuel === 'function' 
    ? options.getSmeltsPerUnitForFuel 
    : null;
  
  const requireStations = options && options.requireStations !== undefined 
    ? !!options.requireStations 
    : true;

  const supply = new Map(initialSupply);

  function add(name: string | null | undefined, count: number): void {
    if (!name || count <= 0) return;
    supply.set(name, (supply.get(name) || 0) + count);
  }

  function take(name: string | null | undefined, count: number): boolean {
    if (!name || count <= 0) return true;
    const cur = supply.get(name) || 0;
    if (cur >= count) {
      supply.set(name, cur - count);
      return true;
    }
    return false;
  }

  function produced(step: ActionStep): string | null {
    if (!step) return null;
    if ('targetItem' in step) {
      return (step as any).targetItem || step.what;
    }
    return step.what.variants[0].value;
  }

  for (const st of path) {
    if (!st) continue;

    if (st.action === 'mine' || st.action === 'hunt') {
      const prod = produced(st);
      add(prod, st.count || 1);
      continue;
    }

    if (st.action === 'craft') {
      if (requireStations && st.what.variants[0].value === 'table') {
        const haveTable = (supply.get('crafting_table') || 0) > 0;
        if (!haveTable) return false;
      }

      if ('ingredients' in st && Array.isArray((st as any).ingredients)) {
        const ingredients = (st as any).ingredients;
        for (const ing of ingredients) {
          const need = (ing?.perCraftCount || 0) * (st.count || 1);
          if (!take(ing?.item, need)) return false;
        }
      }

      const result = 'result' in st ? (st as any).result : null;
      const resItem = result?.item;
      const resCount = (result?.perCraftCount || 1) * (st.count || 1);
      add(resItem, resCount);
      continue;
    }

    if (st.action === 'smelt') {
      if (requireStations) {
        const haveFurnace = (supply.get('furnace') || 0) > 0;
        if (!haveFurnace) return false;
      }

      const input = 'input' in st ? (st as any).input : null;
      const inCount = (input?.perSmelt || 1) * (st.count || 1);
      if (!take(input?.item, inCount)) return false;

      const fuel = 'fuel' in st ? (st as any).fuel : null;
      if (fuel) {
        try {
          const perFuel = getSmeltsPerUnitForFuel ? (getSmeltsPerUnitForFuel(fuel) || 0) : 0;
          const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1);
          if (!take(fuel, fuelNeed)) return false;
        } catch (_) {
          if (!take(fuel, 1)) return false;
        }
      }

      const result = 'result' in st ? (st as any).result : null;
      const outCount = (result?.perSmelt || 1) * (st.count || 1);
      add(result?.item, outCount);
      continue;
    }
  }

  return true;
}

/**
 * Checks if a path is valid with station requirements
 * 
 * @param path - Action path to validate
 * @param initialSupply - Starting inventory
 * @param getSmeltsPerUnitForFuel - Function to get fuel efficiency
 * @returns true if the path is valid
 */
export function isPathValidBasic(
  path: ActionPath,
  initialSupply: Map<string, number>,
  getSmeltsPerUnitForFuel: (fuelName: string) => number
): boolean {
  return simulatePath(path, { initialSupply, getSmeltsPerUnitForFuel, requireStations: true });
}

/**
 * Checks if a path is composable (can be combined with other paths)
 * 
 * Does not require stations to be present, allowing paths to be merged
 * 
 * @param path - Action path to validate
 * @param initialSupply - Starting inventory
 * @param getSmeltsPerUnitForFuel - Function to get fuel efficiency
 * @returns true if the path is composable
 */
export function isPathComposableBasic(
  path: ActionPath,
  initialSupply: Map<string, number>,
  getSmeltsPerUnitForFuel: (fuelName: string) => number
): boolean {
  return simulatePath(path, { initialSupply, getSmeltsPerUnitForFuel, requireStations: false });
}

