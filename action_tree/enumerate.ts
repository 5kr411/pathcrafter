import {
  TreeNode,
  ActionPath,
  ActionStep,
  RequireNode,
  CraftNode,
  MineLeafNode,
  SmeltNode,
  HuntLeafNode,
  VariantTreeNode
} from './types';

/**
 * Enumerates all possible action paths from a recipe tree with variant-first approach
 * @param tree - The recipe tree to enumerate paths from
 * @returns Array of all possible action paths
 */
export function enumerateActionPaths(tree: TreeNode): ActionPath[] {
      function enumerate(node: VariantTreeNode | null | undefined): ActionPath[] {
    if (!node) return [];

    // Root node: aggregate all child paths
    if (node.action === 'root') {
      const results: ActionPath[] = [];
      const children = node.children.variants || [];
      children.forEach(child => {
        const childPaths = enumerate(child.value);
        results.push(...childPaths);
      });
      return results;
    }

    // Require node: AND operation - combine all child paths sequentially
    if (node.action === 'require') {
      const requireNode = node as RequireNode;
      const children = requireNode.children.variants || [];
      if (children.length === 0) return [];

      let combined: ActionPath[] = [[]];
      for (const child of children) {
        const childPaths = enumerate(child.value);
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
      const children = craftNode.children.variants || [];

      if (children.length === 0) {
        // Create action step with variant groups
        const actionStep: ActionStep = {
          action: 'craft',
          variantMode: craftNode.variantMode,
          what: craftNode.what,
          count: craftNode.count,
          result: craftNode.result,
          ingredients: craftNode.ingredients
        };
        return [[actionStep]];
      }

      const perChildPaths = children.map(child => enumerate(child.value));
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
      const actionStep: ActionStep = {
        action: 'craft',
        variantMode: craftNode.variantMode,
        what: craftNode.what,
        count: craftNode.count,
        result: craftNode.result,
        ingredients: craftNode.ingredients
      };
      combined = combined.map(seq => seq.concat([actionStep]));
      return combined;
    }

    // Mine OR group: collect all child paths
    if ((node.action === 'mine' || node.action === 'hunt') && 
        'operator' in node && 
        node.operator === 'OR') {
      const results: ActionPath[] = [];
      const children = node.children.variants || [];
      children.forEach(child => {
        const childPaths = enumerate(child.value);
        results.push(...childPaths);
      });
      return results;
    }

    // Smelt OR group: collect all child paths
    if (node.action === 'smelt' && 
        node.operator === 'OR') {
      const results: ActionPath[] = [];
      const children = node.children.variants || [];
      children.forEach(child => {
        results.push(...enumerate(child.value));
      });
      return results;
    }

    // Smelt AND node: combine dependency paths then append smelt action
    if (node.action === 'smelt' && 
        node.operator === 'AND') {
      const smeltNode = node as SmeltNode;
      const children = smeltNode.children.variants || [];
      let combined: ActionPath[] = [[]];

      for (const child of children) {
        const childPaths = enumerate(child.value);
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
      const actionStep: ActionStep = {
        action: 'smelt',
        variantMode: smeltNode.variantMode,
        what: smeltNode.what,
        count: smeltNode.count,
        input: smeltNode.input,
        result: smeltNode.result,
        fuel: smeltNode.fuel
      };
      combined = combined.map(seq => seq.concat([actionStep]));
      return combined;
    }

    // Leaf mine or hunt node: return single-step path
    if ((node.action === 'mine' || node.action === 'hunt') && 
        node.children.variants.length === 0) {
      const leafNode = node as MineLeafNode | HuntLeafNode;
      
      const actionStep: ActionStep = {
        action: leafNode.action,
        variantMode: leafNode.variantMode,
        what: leafNode.what,
        count: leafNode.count,
        dropChance: 'dropChance' in leafNode ? leafNode.dropChance : undefined,
        tool: leafNode.tool,
        targetItem: leafNode.targetItem
      };
      return [[actionStep]];
    }

    return [];
  }

  return enumerate(tree);
}

