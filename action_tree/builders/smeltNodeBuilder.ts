/**
 * Smelt node builder
 * 
 * Handles building smelt nodes for recipe tree construction.
 * This includes fuel calculation, furnace requirements, and input processing.
 */

import { MinecraftData, SmeltGroupNode, SmeltNode, RequireNode, TreeNode } from '../types';
import { BuildContext } from '../types';
import { chooseMinimalFuelName, getSmeltsPerUnitForFuel } from '../../utils/smeltingConfig';
import { mapToInventoryObject } from '../../utils/inventory';

/**
 * Builds a smelt group node from smelting inputs
 * 
 * @param mcData - Minecraft data object
 * @param primaryItem - Name of the item to obtain
 * @param targetCount - Number of items needed
 * @param smeltInputs - Available smelting inputs
 * @param invMap - Current inventory state
 * @param context - Build context with configuration
 * @param worldBudget - World budget for pruning
 * @param nextVisited - Set of visited items
 * @param buildRecipeTree - Reference to the main tree building function
 * @returns Smelt group node or null if infeasible
 */
export function buildSmeltGroupNode(
  mcData: MinecraftData,
  primaryItem: string,
  targetCount: number,
  smeltInputs: string[],
  invMap: Map<string, number>,
  context: BuildContext,
  worldBudget: any,
  nextVisited: Set<string>,
  buildRecipeTree: Function
): SmeltGroupNode | null {
  if (smeltInputs.length === 0) return null;

  const smeltsNeeded = targetCount;
  const fuelName = chooseMinimalFuelName(mcData) || 'coal';
  const smeltsPerFuel = getSmeltsPerUnitForFuel(fuelName);
  let fuelTotal = Math.ceil(smeltsNeeded / smeltsPerFuel);

  // Deduct existing fuel from inventory
  if (invMap && fuelName) {
    const haveFuel = invMap.get(fuelName) || 0;
    if (haveFuel > 0) fuelTotal = Math.max(0, fuelTotal - haveFuel);
  }

  const smeltGroup: SmeltGroupNode = {
    action: 'smelt',
    operator: 'OR',
    what: primaryItem,
    count: targetCount,
    children: smeltInputs.map(inp => {
      let inputNeeded = smeltsNeeded;
      if (invMap && invMap.size > 0 && inputNeeded > 0) {
        const haveInp = invMap.get(inp) || 0;
        if (haveInp > 0) inputNeeded = Math.max(0, inputNeeded - haveInp);
      }

      const children: TreeNode[] = [];

      // Require furnace
      if (!(invMap && (invMap.get('furnace') || 0) > 0)) {
        children.push({
          action: 'require',
          operator: 'AND',
          what: 'furnace',
          count: 1,
          children: [
            buildRecipeTree(mcData, 'furnace', 1, {
              ...context,
              visited: nextVisited,
              inventory: mapToInventoryObject(invMap),
              worldBudget
            })
          ]
        } as RequireNode);
      }

      // Require fuel
      if (fuelName && fuelTotal > 0) {
        children.push(buildRecipeTree(mcData, fuelName, fuelTotal, {
          ...context,
          visited: nextVisited,
          inventory: mapToInventoryObject(invMap),
          worldBudget
        }));
      }

      // Require input
      if (inputNeeded > 0) {
        children.push(buildRecipeTree(mcData, inp, inputNeeded, {
          ...context,
          visited: nextVisited,
          inventory: mapToInventoryObject(invMap),
          worldBudget
        }));
      }

      const smeltNode: SmeltNode = {
        action: 'smelt',
        operator: 'AND',
        what: 'furnace',
        count: smeltsNeeded,
        result: {
          item: primaryItem,
          perSmelt: 1
        },
        input: {
          item: inp,
          perSmelt: 1
        },
        fuel: fuelName,
        children
      };

      return smeltNode;
    })
  };

  return smeltGroup.children.length > 0 ? smeltGroup : null;
}

/**
 * Creates a simple smelt node for a specific input
 * 
 * @param primaryItem - Name of the item to obtain
 * @param inputItem - Name of the input item
 * @param count - Number of items needed
 * @param fuelItem - Name of the fuel item (optional)
 * @param children - Child nodes for requirements
 * @returns Smelt node
 */
export function createSmeltNode(
  primaryItem: string,
  inputItem: string,
  count: number,
  fuelItem?: string,
  children: TreeNode[] = []
): SmeltNode {
  return {
    action: 'smelt',
    operator: 'AND',
    what: 'furnace',
    count,
    result: {
      item: primaryItem,
      perSmelt: 1
    },
    input: {
      item: inputItem,
      perSmelt: 1
    },
    fuel: fuelItem || null,
    children
  };
}

/**
 * Calculates fuel requirements for smelting
 * 
 * @param smeltsNeeded - Number of smelting operations needed
 * @param fuelName - Name of the fuel to use
 * @param invMap - Current inventory state
 * @returns Total fuel needed after deducting inventory
 */
export function calculateFuelNeeded(
  smeltsNeeded: number,
  fuelName: string,
  invMap: Map<string, number>
): number {
  const smeltsPerFuel = getSmeltsPerUnitForFuel(fuelName);
  let fuelTotal = Math.ceil(smeltsNeeded / smeltsPerFuel);

  // Deduct existing fuel from inventory
  if (invMap && fuelName) {
    const haveFuel = invMap.get(fuelName) || 0;
    if (haveFuel > 0) fuelTotal = Math.max(0, fuelTotal - haveFuel);
  }

  return fuelTotal;
}
