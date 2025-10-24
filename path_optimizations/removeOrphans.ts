import { ActionPath, ActionStep } from '../action_tree/types';

/**
 * Gets the output item and count from a step
 */
function getStepOutput(step: ActionStep): { item: string; perStepCount: number } | null {
  if (step.action === 'craft') {
    const result = step.result?.variants?.[0]?.value;
    if (result && typeof result === 'object' && 'item' in result) {
      return {
        item: result.item,
        perStepCount: result.perCraftCount || 1
      };
    }
  }
  
  if (step.action === 'smelt') {
    const result = step.result?.variants?.[0]?.value;
    if (result && typeof result === 'object' && 'item' in result) {
      return {
        item: result.item,
        perStepCount: result.perSmelt || 1
      };
    }
  }
  
  if (step.action === 'mine' || step.action === 'hunt') {
    const targetItem = (step as any).targetItem?.variants?.[0]?.value;
    if (targetItem) {
      if (typeof targetItem === 'object' && 'item' in targetItem) {
        return {
          item: targetItem.item,
          perStepCount: 1
        };
      }
      if (typeof targetItem === 'string') {
        return {
          item: targetItem,
          perStepCount: 1
        };
      }
    }
    
    const what = step.what?.variants?.[0]?.value;
    if (what && typeof what === 'string') {
      return {
        item: what,
        perStepCount: 1
      };
    }
  }
  
  return null;
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
    
    const ingredients = step.ingredients?.variants?.[0]?.value;
    if (Array.isArray(ingredients)) {
      for (const ing of ingredients) {
        if (ing && typeof ing === 'object' && 'item' in ing) {
          const perCraftCount = ing.perCraftCount || 1;
          const totalNeeded = perCraftCount * stepCount;
          demand.set(ing.item, (demand.get(ing.item) || 0) + totalNeeded);
        }
      }
    }
  }
  
  if (step.action === 'smelt') {
    demand.set('furnace', Math.max((demand.get('furnace') || 0), 1));
    
    const input = step.input?.variants?.[0]?.value;
    if (input && typeof input === 'object' && 'item' in input) {
      const perSmelt = input.perSmelt || 1;
      const totalNeeded = perSmelt * stepCount;
      demand.set(input.item, (demand.get(input.item) || 0) + totalNeeded);
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
    
    const output = getStepOutput(step);
    
    if (!output) {
      adjustedPath.unshift(step);
      continue;
    }
    
    const needed = demand.get(output.item) || 0;
    const perStepCount = output.perStepCount;
    const currentCount = step.count || 1;
    
    if (needed === 0) {
      continue;
    }
    
    const stepsNeeded = Math.ceil(needed / perStepCount);
    const adjustedCount = Math.min(currentCount, stepsNeeded);
    
    if (adjustedCount > 0) {
      const adjustedStep = adjustedCount === currentCount 
        ? step 
        : { ...step, count: adjustedCount };
      
      adjustedPath.unshift(adjustedStep);
      
      const consumed = Math.min(adjustedCount * perStepCount, needed);
      demand.set(output.item, Math.max(0, needed - consumed));
      
      addInputsToDemand(adjustedStep, demand, adjustedCount);
    }
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

