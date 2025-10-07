import { TreeNode, ActionStep } from '../action_tree/types';
import { StreamFunction, PathItem } from './priorityStreams';

/**
 * Function that creates a stream for a leaf node (mine, craft, smelt, hunt)
 */
export type MakeLeafStreamFn<T extends PathItem = PathItem> = (step: ActionStep) => StreamFunction<T>;

/**
 * Function that creates an OR stream from child streams
 */
export type MakeOrStreamFn<T extends PathItem = PathItem> = (childStreams: StreamFunction<T>[]) => StreamFunction<T>;

/**
 * Function that creates an AND stream from child streams with optional parent step
 */
export type MakeAndStreamFn<T extends PathItem = PathItem> = (childStreams: StreamFunction<T>[], parentStepOrNull: ActionStep | null) => StreamFunction<T>;

/**
 * Function that creates a stream from a tree node
 */
export type MakeStreamFn<T extends PathItem = PathItem> = (node: TreeNode) => StreamFunction<T>;

/**
 * Creates a function that generates streams from tree nodes
 * 
 * This factory converts recipe tree nodes into generator streams:
 * - Leaf nodes (mine, craft, smelt, hunt) use makeLeafStream
 * - Nodes with variants include variant metadata in action steps for runtime selection
 * - OR nodes (root, alternate recipes) use makeOrStream
 * - AND nodes (require, multi-ingredient) use makeAndStream
 * 
 * @param makeLeafStream - Function to create streams for leaf actions
 * @param makeOrStream - Function to merge streams with OR logic
 * @param makeAndStream - Function to combine streams with AND logic
 * @returns Function that creates a stream from any tree node
 */
export function createMakeStream<T extends PathItem = PathItem>(
  makeLeafStream: MakeLeafStreamFn<T>,
  makeOrStream: MakeOrStreamFn<T>,
  makeAndStream: MakeAndStreamFn<T>
): MakeStreamFn<T> {
  function makeStream(node: TreeNode): StreamFunction<T> {
    if (!node) {
      return function* () { };
    }

    // Leaf nodes (no children)
    if (!('children' in node) || !node.children || node.children.variants.length === 0) {
      if (node.action === 'craft') {
        // Leaf craft nodes don't have variants (only non-leaf craft nodes do in the combined tree structure)
        // So we don't need to handle variants here
        const step: ActionStep = {
          action: 'craft',
          variantMode: node.variantMode,
          what: node.what,
          count: node.count,
          ...(('result' in node) && { result: (node as any).result }),
          ...(('ingredients' in node) && { ingredients: (node as any).ingredients })
        };
        return makeLeafStream(step);
      }

      if (node.action === 'smelt') {
        const step: ActionStep = {
          action: 'smelt',
          variantMode: node.variantMode,
          what: node.what,
          count: node.count,
          ...(('input' in node) && { input: (node as any).input }),
          ...(('result' in node) && { result: (node as any).result }),
          ...(('fuel' in node) && { fuel: (node as any).fuel })
        };
        return makeLeafStream(step);
      }

      if (node.action === 'mine') {
        const mineNode = node as any;
        
        // Create single step with variant metadata if present
        const step: ActionStep = {
          action: 'mine',
          what: node.what,
          count: node.count,
          ...(('dropChance' in node) && { dropChance: (node as any).dropChance }),
          ...(('tool' in node) && { tool: (node as any).tool }),
          ...(('targetItem' in node) && { targetItem: (node as any).targetItem }),
          // Include variant metadata for runtime decision-making
          ...(mineNode.whatVariants && mineNode.whatVariants.length > 1 && {
            whatVariants: mineNode.whatVariants,
            targetItemVariants: mineNode.targetItemVariants,
            variantMode: mineNode.variantMode
          })
        };
        return makeLeafStream(step);
      }

      if (node.action === 'hunt') {
        const step: ActionStep = {
          action: node.action,
          variantMode: node.variantMode,
          what: node.what,
          count: node.count,
          ...(('dropChance' in node) && { dropChance: (node as any).dropChance }),
          ...(('tool' in node) && { tool: (node as any).tool }),
          ...(('targetItem' in node) && { targetItem: (node as any).targetItem })
        };
        return makeLeafStream(step);
      }

      if (node.action === 'require') {
        const step: ActionStep = {
          action: 'require',
          variantMode: node.variantMode,
          what: node.what,
          count: node.count
        };
        return makeLeafStream(step);
      }

      return function* () { };
    }

    // Nodes with children
    const children = 'children' in node ? node.children.variants.map((v: any) => v.value) : [];

    if (node.action === 'root') {
      return makeOrStream(children.map(makeStream));
    }

    if (node.action === 'require') {
      return makeAndStream(children.map(makeStream), null);
    }

    if (node.action === 'craft') {
      const craftNode = node as any;
      
      // Create single step with variant metadata if present
      const step: ActionStep = {
        action: 'craft',
        what: node.what,
        count: node.count,
        ...(('result' in node) && { result: (node as any).result }),
        ...(('ingredients' in node) && { ingredients: (node as any).ingredients }),
        // Include variant metadata for runtime decision-making
        ...(craftNode.resultVariants && craftNode.resultVariants.length > 1 && {
          resultVariants: craftNode.resultVariants,
          ingredientVariants: craftNode.ingredientVariants,
          variantMode: craftNode.variantMode
        })
      };
      return makeAndStream(children.map(makeStream), step);
    }

    if (node.action === 'smelt') {
      const operator = 'operator' in node ? node.operator : undefined;
      if (operator === 'OR') {
        return makeOrStream(children.map(makeStream));
      }

      const step: ActionStep = {
        action: 'smelt',
        variantMode: node.variantMode,
        what: node.what,
        count: node.count,
        ...(('input' in node) && { input: (node as any).input }),
        ...(('result' in node) && { result: (node as any).result }),
        ...(('fuel' in node) && { fuel: (node as any).fuel })
      };
      return makeAndStream(children.map(makeStream), step);
    }

    if (node.action === 'mine' || node.action === 'hunt') {
      const operator = 'operator' in node ? node.operator : undefined;
      if (operator === 'OR') {
        return makeOrStream(children.map(makeStream));
      }
    }

    return makeOrStream(children.map(makeStream));
  }

  return makeStream;
}

