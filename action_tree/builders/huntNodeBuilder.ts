/**
 * Hunt node builder
 * 
 * Handles creation of hunting nodes for mob drops.
 */

import {
  BuildContext,
  HuntGroupNode,
  HuntLeafNode,
  MobSource
} from '../types';
import {
  createVariantGroup,
  cloneInventoryForBranch
} from './nodeBuilderHelpers';
import {
  filterResourceVariants,
  determineTargetItemsFromMobs,
  isWorldPruningEnabled
} from './variantResolver';

/**
 * Builds hunting nodes for an item and adds them to the root node
 */
export function buildHuntNodes(
  variantsToUse: string[],
  huntingPaths: MobSource[],
  targetCount: number,
  root: any,
  context: BuildContext,
  mcData: any
): void {
  const huntContext = cloneInventoryForBranch(context);
  
  const huntVariants = huntingPaths.map(path => path.mob);
  const filteredHuntVariants = filterResourceVariants(huntContext, 'entities', huntVariants);
  const skipHuntBranch = filteredHuntVariants.length === 0 && isWorldPruningEnabled(huntContext);
  const huntSourceNames = filteredHuntVariants.length > 0 ? filteredHuntVariants : huntVariants;
  
  const huntTargets = context.combineSimilarNodes ? variantsToUse : [variantsToUse[0]];
  const availableHuntTargets = determineTargetItemsFromMobs(mcData, huntSourceNames, huntTargets);

  if (skipHuntBranch) {
    return;
  }

  const huntGroup: HuntGroupNode = {
    action: 'hunt',
    operator: 'OR',
    variantMode: 'any_of',
    what: createVariantGroup('any_of', huntSourceNames),
    count: targetCount,
    variants: { mode: 'any_of', variants: [] },
    children: { mode: 'any_of', variants: [] },
    context: huntContext
  };

  for (const huntingPath of huntingPaths) {
    if (!huntSourceNames.includes(huntingPath.mob)) {
      continue;
    }
    
    const mobTargetItems = new Set<string>();
    Object.entries(mcData.entityLoot || {}).forEach(([_entityId, lootTable]: [string, any]) => {
      if (lootTable && lootTable.entity === huntingPath.mob && lootTable.drops) {
        lootTable.drops.forEach((drop: any) => {
          const dropItemName = drop.item?.toLowerCase().replace(' ', '_');
          if (dropItemName && availableHuntTargets.includes(dropItemName)) {
            mobTargetItems.add(dropItemName);
          }
        });
      }
    });
    const leafHuntTargets = mobTargetItems.size > 0 
      ? Array.from(mobTargetItems) 
      : availableHuntTargets;
    
    const huntLeaf: HuntLeafNode = {
      action: 'hunt',
      variantMode: 'any_of',
      what: createVariantGroup('any_of', [huntingPath.mob]),
      targetItem: createVariantGroup('any_of', leafHuntTargets),
      count: targetCount,
      dropChance: huntingPath.dropChance ? createVariantGroup('any_of', [huntingPath.dropChance]) : undefined,
      variants: { mode: 'any_of', variants: [] },
      children: { mode: 'any_of', variants: [] },
      context: huntContext
    };

    huntGroup.children.variants.push({ value: huntLeaf });
  }

  if (huntGroup.children.variants.length > 0) {
    root.children.variants.push({ value: huntGroup });
  }
}

