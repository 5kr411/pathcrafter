import {
  TreeNode,
  ActionPath,
  RequireNode,
  CraftNode,
  MineLeafNode,
  SmeltNode,
  HuntLeafNode
} from './types';

/**
 * Enumerates all possible action paths from a recipe tree
 * @param tree - The recipe tree to enumerate paths from
 * @returns Array of all possible action paths
 */
export function enumerateActionPaths(tree: TreeNode): ActionPath[] {
  function enumerate(node: TreeNode | null | undefined): ActionPath[] {
    if (!node) return [];

    // Root node: aggregate all child paths
    if (node.action === 'root') {
      const results: ActionPath[] = [];
      const children = node.children || [];
      children.forEach(child => {
        const childPaths = enumerate(child);
        results.push(...childPaths);
      });
      return results;
    }

    // Require node: AND operation - combine all child paths sequentially
    if (node.action === 'require') {
      const requireNode = node as RequireNode;
      const children = requireNode.children || [];
      if (children.length === 0) return [];

      let combined: ActionPath[] = [[]];
      for (const child of children) {
        const childPaths = enumerate(child);
        if (childPaths.length === 0) return [];

        const nextCombined: ActionPath[] = [];
        combined.forEach(prefix => {
          childPaths.forEach(seq => {
            nextCombined.push(prefix.concat(seq));
          });
        });
        combined = nextCombined;
      }
      return combined;
    }

    // Craft node: AND operation - combine ingredient paths then append craft action
    if (node.action === 'craft') {
      const craftNode = node as CraftNode;
      const children = craftNode.children || [];

      if (children.length === 0) {
        // Don't expand variants - just use the primary recipe
        // Variants are metadata for display/flexibility, not for path explosion
        return [[{
          action: 'craft',
          what: craftNode.what,
          count: craftNode.count,
          result: craftNode.result,
          ingredients: craftNode.ingredients
        }]];
      }

      const perChildPaths = children.map(enumerate);
      if (perChildPaths.some(p => p.length === 0)) return [];

      let combined: ActionPath[] = [[]];
      perChildPaths.forEach(pathSet => {
        const nextCombined: ActionPath[] = [];
        combined.forEach(prefix => {
          pathSet.forEach(childPath => {
            nextCombined.push(prefix.concat(childPath));
          });
        });
        combined = nextCombined;
      });

      // Append the craft action at the end
      // Don't expand variants - variants are metadata, not for path explosion
      combined = combined.map(seq => seq.concat([{
        action: 'craft',
        what: craftNode.what,
        count: craftNode.count,
        result: craftNode.result,
        ingredients: craftNode.ingredients
      }]));
      return combined;
    }

    // Mine OR group: collect all child paths
    if ((node.action === 'mine' || node.action === 'hunt') && 
        'operator' in node && 
        node.operator === 'OR' && 
        node.children && 
        node.children.length > 0) {
      const results: ActionPath[] = [];
      node.children.forEach(child => {
        const childPaths = enumerate(child);
        results.push(...childPaths);
      });
      return results;
    }

    // Smelt OR group: collect all child paths
    if (node.action === 'smelt' && 
        node.operator === 'OR' && 
        node.children && 
        node.children.length > 0) {
      const results: ActionPath[] = [];
      node.children.forEach(child => {
        results.push(...enumerate(child));
      });
      return results;
    }

    // Smelt AND node: combine dependency paths then append smelt action
    if (node.action === 'smelt' && 
        node.operator === 'AND' && 
        node.children && 
        node.children.length > 0) {
      const smeltNode = node as SmeltNode;
      let combined: ActionPath[] = [[]];

      for (const child of smeltNode.children) {
        const childPaths = enumerate(child);
        if (childPaths.length === 0) return [];

        const nextCombined: ActionPath[] = [];
        combined.forEach(prefix => {
          childPaths.forEach(seq => {
            nextCombined.push(prefix.concat(seq));
          });
        });
        combined = nextCombined;
      }

      // Append the smelt action at the end
      combined = combined.map(seq => seq.concat([{
        action: 'smelt',
        what: 'furnace',
        count: smeltNode.count,
        input: smeltNode.input,
        result: smeltNode.result,
        fuel: smeltNode.fuel
      }]));
      return combined;
    }

    // Leaf mine or hunt node: return single-step path
    if ((node.action === 'mine' || node.action === 'hunt') && 
        (!node.children || node.children.length === 0)) {
      const leafNode = node as MineLeafNode | HuntLeafNode;
      
      // Don't expand variants - variants are metadata, not for path explosion
      return [[{
        action: leafNode.action,
        what: leafNode.what,
        count: leafNode.count,
        dropChance: 'dropChance' in leafNode ? leafNode.dropChance : undefined,
        tool: leafNode.tool,
        targetItem: leafNode.targetItem
      }]];
    }

    return [];
  }

  return enumerate(tree);
}

