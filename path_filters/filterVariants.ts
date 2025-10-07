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
  // Handle mining steps with variants
  if (step.action === 'mine' && step.what.variants.length > 1) {
    const availableVariants: string[] = [];
    const availableTargetItems: string[] = [];

    for (let i = 0; i < step.what.variants.length; i++) {
      const variant = step.what.variants[i].value;
      const targetItem = step.targetItem?.variants[i]?.value || variant;
      
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
        what: {
          mode: 'one_of' as const,
          variants: [{ value: availableVariants[0] }]
        },
        targetItem: step.targetItem ? {
          mode: 'one_of' as const,
          variants: [{ value: availableTargetItems[0] }]
        } : undefined,
        variantMode: 'one_of' as const
      };
    }

    // Multiple variants available - update the arrays
    return {
      ...step,
      what: {
        mode: step.what.mode,
        variants: availableVariants.map(v => ({ value: v }))
      },
      targetItem: step.targetItem ? {
        mode: step.targetItem.mode,
        variants: availableTargetItems.map(v => ({ value: v }))
      } : undefined,
      variantMode: step.variantMode
    };
  }

  // Handle crafting steps with variants
  if (step.action === 'craft' && step.result && step.ingredients && step.result.variants.length > 1) {
    // For craft nodes, we don't filter based on ingredient availability
    // Crafting can produce items that aren't directly available in the world
    // Only mining nodes should be filtered based on world availability
    // So we just select the first variant that has at least one available source
    
    let selectedVariantIndex = 0;
    for (let i = 0; i < step.ingredients.variants.length; i++) {
      const ingredients = step.ingredients.variants[i].value;
      let hasAtLeastOneSource = false;
      
      for (const ingredient of ingredients) {
        // Check if ingredient is available as a block in the world
        const hasDirectly = availability.blocks.has(ingredient.item) && availability.blocks.get(ingredient.item)! > 0;
        
        // Check if there's a common source (e.g., oak_log for oak_planks)
        const possibleSource = ingredient.item.replace(/_planks$/, '_log')
                                        .replace(/_ingot$/, '_ore');
        const hasSource = availability.blocks.has(possibleSource) && availability.blocks.get(possibleSource)! > 0;
        
        if (hasDirectly || hasSource) {
          hasAtLeastOneSource = true;
          break;
        }
      }
      
      if (hasAtLeastOneSource) {
        selectedVariantIndex = i;
        break;
      }
    }
    
    // If only one variant available, simplify
    if (step.result.variants.length === 1) {
      return {
        ...step,
        result: {
          mode: 'one_of' as const,
          variants: [step.result.variants[0]]
        },
        ingredients: {
          mode: 'one_of' as const,
          variants: [step.ingredients.variants[selectedVariantIndex]]
        },
        variantMode: 'one_of' as const
      };
    }

    // Multiple variants available - keep all variants but use available one as primary
    return {
      ...step,
      result: {
        mode: step.result.mode,
        variants: step.result.variants
      },
      ingredients: {
        mode: step.ingredients.mode,
        variants: step.ingredients.variants
      },
      variantMode: step.variantMode
    };
  }

  // Handle hunting steps with variants
  if (step.action === 'hunt' && step.what.variants.length > 1) {
    const availableVariants: string[] = [];

    for (const variant of step.what.variants) {
      if (availability.entities.has(variant.value) && availability.entities.get(variant.value)! > 0) {
        availableVariants.push(variant.value);
      }
    }

    if (availableVariants.length === 0) {
      return null;
    }

    if (availableVariants.length === 1) {
      return {
        ...step,
        what: {
          mode: 'one_of' as const,
          variants: [{ value: availableVariants[0] }]
        },
        variantMode: 'one_of' as const
      };
    }

    return {
      ...step,
      what: {
        mode: step.what.mode,
        variants: availableVariants.map(v => ({ value: v }))
      },
      variantMode: step.variantMode
    };
  }

  // No variants or not applicable - return as-is
  return step;
}
