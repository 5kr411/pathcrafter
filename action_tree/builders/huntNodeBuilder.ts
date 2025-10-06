/**
 * Hunt node builder
 * 
 * Handles building hunt nodes for recipe tree construction.
 * This includes drop chance calculations, world budget checks, and mob selection.
 */

import { MinecraftData, HuntGroupNode, HuntLeafNode } from '../types';
import { findMobsThatDrop } from '../utils/sourceLookup';
import { createWorldBudgetAccessors } from '../../utils/worldBudget';

/**
 * Builds a hunt group node from mob sources
 * 
 * @param mcData - Minecraft data object
 * @param primaryItem - Name of the item to obtain
 * @param targetCount - Number of items needed
 * @param huntingPaths - Available hunting sources
 * @param worldBudget - World budget for pruning
 * @returns Hunt group node or null if infeasible
 */
export function buildHuntGroupNode(
  _mcData: MinecraftData,
  primaryItem: string,
  targetCount: number,
  huntingPaths: Array<{mob: string, dropChance?: number}>,
  worldBudget: any
): HuntGroupNode | null {
  if (huntingPaths.length === 0) return null;

  const wb = createWorldBudgetAccessors(worldBudget);

  const huntGroup: HuntGroupNode = {
    action: 'hunt',
    operator: 'OR',
    what: primaryItem,
    count: targetCount,
    children: huntingPaths.map(s => {
      const p = s.dropChance && s.dropChance > 0 ? s.dropChance : 1;
      const expectedKills = Math.ceil(targetCount / p);

      if (!wb.can('entities', s.mob, expectedKills)) return null;

      const huntLeaf: HuntLeafNode = {
        action: 'hunt',
        what: s.mob,
        targetItem: primaryItem,
        count: expectedKills,
        dropChance: s.dropChance,
        children: []
      };
      return huntLeaf;
    }).filter((n): n is HuntLeafNode => n !== null)
  };

  return huntGroup.children.length > 0 ? huntGroup : null;
}

/**
 * Creates a hunt group node by finding mobs that drop the target item
 * 
 * @param mcData - Minecraft data object
 * @param primaryItem - Name of the item to obtain
 * @param targetCount - Number of items needed
 * @param worldBudget - World budget for pruning
 * @returns Hunt group node or null if no mobs drop the item
 */
export function buildHuntGroupNodeForItem(
  mcData: MinecraftData,
  primaryItem: string,
  targetCount: number,
  worldBudget: any
): HuntGroupNode | null {
  const huntingPaths = findMobsThatDrop(mcData, primaryItem);
  return buildHuntGroupNode(mcData, primaryItem, targetCount, huntingPaths, worldBudget);
}

/**
 * Creates a simple hunt leaf node for a specific mob
 * 
 * @param mobName - Name of the mob to hunt
 * @param targetItem - Name of the item to obtain
 * @param count - Number of mobs to kill
 * @param dropChance - Drop chance for the item (optional)
 * @returns Hunt leaf node
 */
export function createHuntLeafNode(
  mobName: string,
  targetItem: string,
  count: number,
  dropChance?: number
): HuntLeafNode {
  return {
    action: 'hunt',
    what: mobName,
    targetItem,
    count,
    dropChance,
    children: []
  };
}

/**
 * Calculates expected kills needed for a target item count
 * 
 * @param targetCount - Number of items needed
 * @param dropChance - Drop chance for the item
 * @returns Expected number of mobs to kill
 */
export function calculateExpectedKills(targetCount: number, dropChance?: number): number {
  const p = dropChance && dropChance > 0 ? dropChance : 1;
  return Math.ceil(targetCount / p);
}

/**
 * Checks if hunting a mob is feasible given world budget constraints
 * 
 * @param worldBudget - World budget object
 * @param mobName - Name of the mob to hunt
 * @param expectedKills - Expected number of mobs to kill
 * @returns True if hunting is feasible
 */
export function isHuntingFeasible(worldBudget: any, mobName: string, expectedKills: number): boolean {
  if (!worldBudget) return true;
  
  const wb = createWorldBudgetAccessors(worldBudget);
  return wb.can('entities', mobName, expectedKills);
}
