import { ActionPath, ActionStep } from '../action_tree/types';
import { getSmeltsPerUnitForFuel } from '../utils/smeltingConfig';

/**
 * Gets all possible output items and per-step counts from a step.
 * Returns a map of item -> perStepCount.
 */
function getStepOutputs(step: ActionStep): Map<string, number> {
  const outputs = new Map<string, number>();

  const addOutput = (item: string | undefined, perStepCount: number) => {
    if (!item) return;
    const existing = outputs.get(item) || 0;
    outputs.set(item, Math.max(existing, perStepCount));
  };

  if (step.action === 'craft') {
    const variants = step.result?.variants || [];
    for (const variant of variants) {
      const value: any = variant?.value;
      const item = typeof value === 'object' && value ? value.item : (typeof value === 'string' ? value : undefined);
      const perStepCount = typeof value === 'object' && value ? (value.perCraftCount || 1) : 1;
      if (item) {
        addOutput(item, perStepCount);
      }
    }
  }

  if (step.action === 'smelt') {
    const variants = step.result?.variants || [];
    for (const variant of variants) {
      const value: any = variant?.value;
      const item = typeof value === 'object' && value ? value.item : (typeof value === 'string' ? value : undefined);
      const perStepCount = typeof value === 'object' && value ? (value.perSmelt || 1) : 1;
      if (item) {
        addOutput(item, perStepCount);
      }
    }
  }

  if (step.action === 'mine' || step.action === 'hunt') {
    const targetItems = (step as any).targetItem?.variants || [];
    for (const variant of targetItems) {
      const value: any = variant?.value;
      const item = typeof value === 'object' && value ? value.item : (typeof value === 'string' ? value : undefined);
      if (item) {
        addOutput(item, 1);
      }
    }

    if (outputs.size === 0) {
      const whatVariants = step.what?.variants || [];
      for (const variant of whatVariants) {
        const value: any = variant?.value;
        const item = typeof value === 'string' ? value : (typeof value === 'object' && value ? value.item : undefined);
        if (item) {
          addOutput(item, 1);
        }
      }
    }
  }

  return outputs;
}

/**
 * Adds the inputs of a step to the demand map
 */
function addInputsToDemand(step: ActionStep, demand: Map<string, number>, stepCount: number): void {
  if (step.action === 'craft') {
    const whatValue = step.what?.variants?.[0]?.value;
    if (whatValue === 'table') {
      demand.set('crafting_table', Math.max((demand.get('crafting_table') || 0), 1));
    }
    
    const ingredientVariants = step.ingredients?.variants || [];
    const maxPerCraftByItem = new Map<string, number>();
    for (const variant of ingredientVariants) {
      const ingredients = Array.isArray(variant?.value) ? variant.value : [];
      for (const ing of ingredients) {
        if (ing && typeof ing === 'object' && 'item' in ing) {
          const perCraftCount = ing.perCraftCount || 1;
          const existing = maxPerCraftByItem.get(ing.item) || 0;
          if (perCraftCount > existing) {
            maxPerCraftByItem.set(ing.item, perCraftCount);
          }
        }
      }
    }
    for (const [item, perCraftCount] of maxPerCraftByItem.entries()) {
      const totalNeeded = perCraftCount * stepCount;
      demand.set(item, (demand.get(item) || 0) + totalNeeded);
    }
  }
  
  if (step.action === 'smelt') {
    demand.set('furnace', Math.max((demand.get('furnace') || 0), 1));
    
    const inputVariants = step.input?.variants || [];
    const maxPerSmeltByItem = new Map<string, number>();
    for (const variant of inputVariants) {
      const value: any = variant?.value;
      if (value && typeof value === 'object' && 'item' in value) {
        const perSmelt = value.perSmelt || 1;
        const existing = maxPerSmeltByItem.get(value.item) || 0;
        if (perSmelt > existing) {
          maxPerSmeltByItem.set(value.item, perSmelt);
        }
      }
    }
    for (const [item, perSmelt] of maxPerSmeltByItem.entries()) {
      const totalNeeded = perSmelt * stepCount;
      demand.set(item, (demand.get(item) || 0) + totalNeeded);
    }
    
    const fuel = step.fuel?.variants?.[0]?.value;
    if (fuel && typeof fuel === 'string') {
      const smeltsPerFuelUnit = getSmeltsPerUnitForFuel(fuel);
      if (smeltsPerFuelUnit > 0) {
        const fuelNeeded = Math.ceil(stepCount / smeltsPerFuelUnit);
        demand.set(fuel, (demand.get(fuel) || 0) + fuelNeeded);
      }
    }
  }
  
  if (step.action === 'mine' || step.action === 'hunt') {
    const tool = (step as any).tool?.variants?.[0]?.value;
    if (tool && typeof tool === 'string') {
      demand.set(tool, Math.max((demand.get(tool) || 0), 1));
    }
  }
}

/**
 * Seeds the demand map by processing the final step
 * The final step is what we're trying to achieve, so we always need it
 * and should demand its inputs
 */
function seedWithFinalStep(path: ActionPath, demand: Map<string, number>): { lastStepIndex: number } {
  if (path.length === 0) return { lastStepIndex: -1 };
  
  const lastStep = path[path.length - 1];
  if (lastStep) {
    addInputsToDemand(lastStep, demand, lastStep.count || 1);
  }
  
  return { lastStepIndex: path.length - 1 };
}

/**
 * Removes orphaned ingredient steps from a path
 * 
 * After dedupePersistentItems removes duplicate persistent item crafts,
 * the ingredient steps that fed into those removed crafts become orphaned.
 * This function walks the path backwards, tracking demand for each item,
 * and removes or reduces steps whose outputs aren't actually needed.
 * 
 * @param path - The action path to clean up
 * @returns Path with orphaned steps removed and counts adjusted
 * 
 * @example
 * // Input: [mine oak_log x8, craft planks x8, craft sticks x4, craft pickaxe x1]
 * // (After dedupe removed 3 extra pickaxe crafts but left their ingredients)
 * // Output: [mine oak_log x2, craft planks x2, craft sticks x1, craft pickaxe x1]
 */
export function removeOrphanedIngredientsInPath(path: ActionPath): ActionPath {
  if (!Array.isArray(path) || path.length === 0) return path;
  
  const demand = new Map<string, number>();
  
  const { lastStepIndex } = seedWithFinalStep(path, demand);
  
  if (lastStepIndex < 0) return path;
  
  const adjustedPath: ActionPath = [];
  
  for (let i = lastStepIndex - 1; i >= 0; i--) {
    const step = path[i];
    if (!step) continue;
    
    const outputs = getStepOutputs(step);
    
    if (outputs.size === 0) {
      adjustedPath.unshift(step);
      continue;
    }
    
    const outputItems = Array.from(outputs.keys());
    const demandedItems = outputItems.filter(item => (demand.get(item) || 0) > 0);
    
    if (demandedItems.length === 0) {
      continue;
    }
    
    const currentCount = step.count || 1;

    // If output is unambiguous, adjust counts and reduce demand.
    if (outputItems.length === 1 && demandedItems.length === 1) {
      const outputItem = outputItems[0];
      const perStepCount = outputs.get(outputItem) || 1;
      const needed = demand.get(outputItem) || 0;
      const stepsNeeded = Math.ceil(needed / perStepCount);
      const adjustedCount = Math.min(currentCount, stepsNeeded);
      
      if (adjustedCount > 0) {
        const adjustedStep = adjustedCount === currentCount 
          ? step 
          : { ...step, count: adjustedCount };
        
        adjustedPath.unshift(adjustedStep);
        
        const consumed = Math.min(adjustedCount * perStepCount, needed);
        demand.set(outputItem, Math.max(0, needed - consumed));
        
        addInputsToDemand(adjustedStep, demand, adjustedCount);
      }
      continue;
    }

    // Ambiguous outputs: keep step but do not reduce demand (conservative).
    adjustedPath.unshift(step);
    addInputsToDemand(step, demand, currentCount);
  }
  
  adjustedPath.push(path[lastStepIndex]);
  
  return adjustedPath;
}

/**
 * Removes orphaned ingredients from multiple paths
 * 
 * @param paths - Array of action paths to clean up
 * @returns Array of cleaned paths
 */
export function removeOrphanedIngredientsInPaths(paths: ActionPath[]): ActionPath[] {
  if (!Array.isArray(paths)) return paths;
  return paths.map(p => removeOrphanedIngredientsInPath(p));
}
