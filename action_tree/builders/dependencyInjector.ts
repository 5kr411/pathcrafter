/**
 * Dependency injection utilities
 * 
 * Handles injection of workstation (crafting table, furnace) and tool
 * dependencies into tree nodes. Ensures dependencies are built before
 * they are needed.
 */

import { BuildContext, RootNode } from '../types';
import { createDependencyContext } from './nodeBuilderHelpers';
import { hasEqualOrBetterTool } from '../../utils/items';

/**
 * Checks if a workstation dependency is already satisfied in the tree
 */
export function hasWorkstationDependency(node: any, workstationName: string): boolean {
  if (!node || !node.children || !node.children.variants) return false;
  
  return node.children.variants.some((child: any) => {
    const childNode = child.value;
    if (childNode && childNode.action === 'root' && 
        childNode.what && childNode.what.variants[0] && 
        childNode.what.variants[0].value === workstationName) {
      return true;
    }
    return hasWorkstationDependency(childNode, workstationName);
  });
}

/**
 * Checks if a tool dependency is already satisfied in the tree
 */
export function hasToolDependency(node: any, toolName: string): boolean {
  if (!node || !node.children || !node.children.variants) return false;
  
  return node.children.variants.some((child: any) => {
    const childNode = child.value;
    if (childNode && childNode.action === 'root' && 
        childNode.what && childNode.what.variants[0] && 
        childNode.what.variants[0].value === toolName) {
      return true;
    }
    return hasToolDependency(childNode, toolName);
  });
}

/**
 * Builds a dependency tree for a workstation or tool
 * 
 * This is a forward declaration that will be implemented by the
 * orchestrator. We pass it in as a parameter to avoid circular dependencies.
 */
export type BuildRecipeTreeFn = (
  ctx: any,
  itemNames: string[],
  targetCount: number,
  context: BuildContext
) => RootNode;

/**
 * Injects workstation dependency into a node if not already present
 */
export function injectWorkstationDependency(
  node: any,
  workstationName: string,
  context: BuildContext,
  ctx: any,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  // If we already have the workstation in inventory, don't inject any subtree
  const haveInInventory = context?.inventory?.get(workstationName) || 0;
  if (haveInInventory > 0) {
    return;
  }

  if (!hasWorkstationDependency(node, workstationName)) {
    const depContext = createDependencyContext(workstationName, context);
    const workstationTree = buildRecipeTreeFn(ctx, [workstationName], 1, depContext);
    node.children.variants.push({ value: workstationTree });
  }
}

/**
 * Injects tool dependency into a node if not already present
 * 
 * Checks inventory first - if an equal or better tool is already available,
 * no dependency subtree is created. This prevents redundant tool crafting.
 * 
 * For example, if wooden_pickaxe is required but the bot already has
 * diamond_pickaxe, no wooden_pickaxe dependency will be injected.
 */
export function injectToolDependency(
  node: any,
  toolName: string,
  context: BuildContext,
  ctx: any,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  // Check if we have the exact tool OR a better tool of the same type
  if (hasEqualOrBetterTool(context?.inventory, toolName)) {
    return;
  }

  if (!hasToolDependency(node, toolName)) {
    const depContext = createDependencyContext(toolName, context);
    const toolTree = buildRecipeTreeFn(ctx, [toolName], 1, depContext);
    node.children.variants.push({ value: toolTree });
  }
}

