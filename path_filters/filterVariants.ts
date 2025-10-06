import { ActionPath, ActionStep } from '../action_tree/types';
import { WorldSnapshot, WorldAvailability } from './types';
import { buildWorldAvailability } from './worldResources';

/**
 * Filters variant lists in action steps based on world availability
 * 
 * For steps with variants (whatVariants, resultVariants), this function:
 * - Keeps only variants that are available in the world snapshot
 * - Updates the primary 'what' or 'result' to reflect an available variant
 * - Removes steps if no variants are available
 * 
 * This ensures paths only reference resources that actually exist in the world.
 * 
 * @param paths - Array of action paths to filter
 * @param snapshot - World snapshot containing resource availability
 * @returns Array of paths with filtered variants
 */
export function filterPathVariantsByWorld(
  paths: ActionPath[],
  snapshot: WorldSnapshot | null | undefined
): ActionPath[] {
  if (!snapshot) return paths;
  
  const availability = buildWorldAvailability(snapshot);
  const filteredPaths: ActionPath[] = [];

  for (const path of paths) {
    const filteredPath = filterSinglePathVariants(path, availability);
    if (filteredPath.length > 0) {
      filteredPaths.push(filteredPath);
    }
  }

  return filteredPaths;
}

/**
 * Filters variants in a single path based on world availability
 */
function filterSinglePathVariants(
  path: ActionPath,
  availability: WorldAvailability
): ActionPath {
  const filteredSteps: ActionStep[] = [];

  for (const step of path) {
    const filteredStep = filterStepVariants(step, availability);
    if (filteredStep) {
      filteredSteps.push(filteredStep);
    }
  }

  return filteredSteps;
}

/**
 * Filters variants in a single action step
 */
function filterStepVariants(
  step: ActionStep,
  availability: WorldAvailability
): ActionStep | null {
  // Handle mining steps with whatVariants
  if (step.action === 'mine' && step.whatVariants && step.whatVariants.length > 1) {
    const availableVariants: string[] = [];
    const availableTargetItems: string[] = [];

    for (let i = 0; i < step.whatVariants.length; i++) {
      const variant = step.whatVariants[i];
      const targetItem = step.targetItemVariants?.[i] || variant;
      
      // Check if this variant is available in the world
      if (availability.blocks.has(variant) && availability.blocks.get(variant)! > 0) {
        availableVariants.push(variant);
        availableTargetItems.push(targetItem);
      }
    }

    // If no variants available, filter out this step
    if (availableVariants.length === 0) {
      return null;
    }

    // If only one variant available, simplify by removing variant arrays
    if (availableVariants.length === 1) {
      return {
        ...step,
        what: availableVariants[0],
        targetItem: availableTargetItems[0],
        whatVariants: undefined,
        targetItemVariants: undefined,
        variantMode: undefined
      };
    }

    // Multiple variants available - update the arrays
    return {
      ...step,
      what: availableVariants[0], // Use first available as primary
      targetItem: availableTargetItems[0],
      whatVariants: availableVariants,
      targetItemVariants: availableTargetItems,
      variantMode: step.variantMode
    };
  }

  // Handle crafting steps with resultVariants
  if (step.action === 'craft' && step.resultVariants && step.ingredientVariants && step.resultVariants.length > 1) {
    const availableResults: string[] = [];
    const availableIngredients: string[][] = [];

    // For each result variant, check if its ingredients could be available
    for (let i = 0; i < step.resultVariants.length; i++) {
      const ingredients = step.ingredientVariants[i];
      
      // Check if all ingredients for this variant could be acquired
      // For now, we use a simple heuristic: check if the primary ingredient exists as a block
      // This works for wood families (oak_log -> oak_planks, etc.)
      let variantPossible = true;
      
      for (const ingredient of ingredients) {
        // Check both direct availability and common sources
        const hasDirectly = availability.blocks.has(ingredient) && availability.blocks.get(ingredient)! > 0;
        
        // Check if there's a common source (e.g., oak_log for oak_planks)
        const possibleSource = ingredient.replace(/_planks$/, '_log')
                                        .replace(/_ingot$/, '_ore');
        const hasSource = availability.blocks.has(possibleSource) && availability.blocks.get(possibleSource)! > 0;
        
        if (!hasDirectly && !hasSource) {
          variantPossible = false;
          break;
        }
      }
      
      if (variantPossible) {
        availableResults.push(step.resultVariants[i]);
        availableIngredients.push(ingredients);
      }
    }

    // If no variants available, filter out this step
    if (availableResults.length === 0) {
      return null;
    }

    // If only one variant available, simplify
    if (availableResults.length === 1) {
      return {
        ...step,
        result: step.result ? { ...step.result, item: availableResults[0] } : undefined,
        ingredients: step.ingredients!.map((ing, idx) => ({
          ...ing,
          item: availableIngredients[0][idx]
        })),
        resultVariants: undefined,
        ingredientVariants: undefined,
        variantMode: undefined
      };
    }

    // Multiple variants available - update the arrays
    return {
      ...step,
      result: step.result ? { ...step.result, item: availableResults[0] } : undefined,
      ingredients: step.ingredients!.map((ing, idx) => ({
        ...ing,
        item: availableIngredients[0][idx]
      })),
      resultVariants: availableResults,
      ingredientVariants: availableIngredients,
      variantMode: step.variantMode
    };
  }

  // Handle hunting steps with whatVariants (if ever added)
  if (step.action === 'hunt' && 'whatVariants' in step && Array.isArray((step as any).whatVariants)) {
    const whatVariants = (step as any).whatVariants as string[];
    const availableVariants: string[] = [];

    for (const variant of whatVariants) {
      if (availability.entities.has(variant) && availability.entities.get(variant)! > 0) {
        availableVariants.push(variant);
      }
    }

    if (availableVariants.length === 0) {
      return null;
    }

    if (availableVariants.length === 1) {
      return {
        ...step,
        what: availableVariants[0],
        whatVariants: undefined,
        variantMode: undefined
      } as any;
    }

    return {
      ...step,
      what: availableVariants[0],
      whatVariants: availableVariants,
      variantMode: (step as any).variantMode
    } as any;
  }

  // No variants or not applicable - return as-is
  return step;
}
