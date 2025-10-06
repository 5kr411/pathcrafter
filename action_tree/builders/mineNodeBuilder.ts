/**
 * Mine node builder
 * 
 * Handles building mine nodes for recipe tree construction.
 * This includes tool selection, variant handling, and world budget checks.
 */

import { MinecraftData, MineGroupNode, MineLeafNode } from '../types';
import { BuildContext } from '../types';
import { chooseMinimalToolName } from '../../utils/items';
import { createWorldBudgetAccessors } from '../../utils/worldBudget';

/**
 * Builds a mine group node from block sources
 * 
 * @param mcData - Minecraft data object
 * @param primaryItem - Name of the item to obtain
 * @param targetCount - Number of items needed
 * @param miningPaths - Available mining sources
 * @param invMap - Current inventory state
 * @param context - Build context with configuration
 * @param worldBudget - World budget for pruning
 * @returns Mine group node or null if infeasible
 */
export function buildMineGroupNode(
  _mcData: MinecraftData,
  primaryItem: string,
  targetCount: number,
  miningPaths: Array<{block: string, tool: string, _blockVariants?: string[], _targetVariants?: string[]}>,
  invMap: Map<string, number>,
  context: BuildContext,
  worldBudget: any
): MineGroupNode | null {
  if (miningPaths.length === 0) return null;

  const wb = createWorldBudgetAccessors(worldBudget);
  const { avoidTool, preferMinimalTools } = context;

  const mineGroup: MineGroupNode = {
    action: 'mine',
    operator: 'OR',
    what: primaryItem,
    count: targetCount,
    children: miningPaths.flatMap(s => {
      if (!s.tool || s.tool === 'any') {
        if (!wb.can('blocks', s.block, targetCount)) return [];
        const leafNode: MineLeafNode = {
          action: 'mine',
          what: s.block,
          targetItem: primaryItem,
          count: targetCount,
          children: []
        };
        
        // Add variant information if available
        if ((s as any)._blockVariants && context.combineSimilarNodes) {
          const blockVariants = (s as any)._blockVariants;
          const targetVariants = (s as any)._targetVariants || [primaryItem];
          if (blockVariants.length > 1) {
            leafNode.whatVariants = blockVariants; // All block types
            leafNode.targetItemVariants = targetVariants; // The items they drop
            leafNode.variantMode = 'one_of';
          }
        }
        
        return [leafNode];
      }

      let tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);

      // Prefer existing tools
      const existing = tools.filter(t => {
        if (!invMap) return false;
        const count = invMap.get(t);
        return typeof count === 'number' && count > 0;
      });
      
      if (existing.length > 0) {
        const chosen = (preferMinimalTools && existing.length > 1) ? chooseMinimalToolName(existing) : existing[0];
        if (!wb.can('blocks', s.block, targetCount)) return [];
        const leafNode: MineLeafNode = {
          action: 'mine',
          what: s.block,
          targetItem: primaryItem,
          tool: chosen,
          count: targetCount,
          children: []
        };
        
        // Add variant information if available
        if ((s as any)._blockVariants && context.combineSimilarNodes) {
          const blockVariants = (s as any)._blockVariants;
          const targetVariants = (s as any)._targetVariants || [primaryItem];
          if (blockVariants.length > 1) {
            leafNode.whatVariants = blockVariants;
            leafNode.targetItemVariants = targetVariants;
            leafNode.variantMode = 'one_of';
          }
        }
        
        return [leafNode];
      }

      // Need to craft tools
      const chosen = preferMinimalTools ? chooseMinimalToolName(tools) : tools[0];
      if (!wb.can('blocks', s.block, targetCount)) return [];
      
      const leafNode: MineLeafNode = {
        action: 'mine',
        what: s.block,
        targetItem: primaryItem,
        tool: chosen,
        count: targetCount,
        children: []
      };
      
      // Add variant information if available
      if ((s as any)._blockVariants && context.combineSimilarNodes) {
        const blockVariants = (s as any)._blockVariants;
        const targetVariants = (s as any)._targetVariants || [primaryItem];
        if (blockVariants.length > 1) {
          leafNode.whatVariants = blockVariants;
          leafNode.targetItemVariants = targetVariants;
          leafNode.variantMode = 'one_of';
        }
      }
      
      return [leafNode];
    })
  };

  return mineGroup.children.length > 0 ? mineGroup : null;
}

/**
 * Creates a simple mine leaf node for a specific block
 * 
 * @param blockName - Name of the block to mine
 * @param targetItem - Name of the item to obtain
 * @param count - Number of items needed
 * @param tool - Tool required (optional)
 * @returns Mine leaf node
 */
export function createMineLeafNode(
  blockName: string,
  targetItem: string,
  count: number,
  tool?: string
): MineLeafNode {
  return {
    action: 'mine',
    what: blockName,
    targetItem,
    count,
    children: [],
    ...(tool && { tool })
  };
}

/**
 * Checks if a mining path is feasible given world budget constraints
 * 
 * @param worldBudget - World budget object
 * @param blockName - Name of the block to mine
 * @param count - Number of blocks needed
 * @returns True if mining is feasible
 */
export function isMiningFeasible(worldBudget: any, blockName: string, count: number): boolean {
  if (!worldBudget) return true;
  
  const wb = createWorldBudgetAccessors(worldBudget);
  return wb.can('blocks', blockName, count);
}
