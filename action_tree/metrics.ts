import { TreeNode } from './types';

/**
 * Computes the maximum depth of the tree
 * @param node - The tree node to analyze
 * @returns The maximum depth of the tree
 */
export function computeTreeMaxDepth(node: TreeNode | null | undefined): number {
  if (!node) return 0;
  if (!node.children || node.children.length === 0) return 1;

  let maxChild = 0;
  for (const child of node.children) {
    const d = computeTreeMaxDepth(child);
    if (d > maxChild) maxChild = d;
  }
  return 1 + maxChild;
}

/**
 * Counts the total number of possible action paths in the tree
 * @param node - The tree node to analyze
 * @returns The number of possible paths through the tree
 */
export function countActionPaths(node: TreeNode | null | undefined): number {
  if (!node) return 0;
  if (!node.children || node.children.length === 0) {
    return node.action === 'root' ? 0 : 1;
  }

  // AND nodes multiply the path counts of their children
  if (node.action === 'craft' || node.action === 'require' || ('operator' in node && node.operator === 'AND')) {
    let total = 1;
    for (const child of node.children) {
      total *= countActionPaths(child);
    }
    return total;
  }

  // OR nodes sum the path counts of their children
  let sum = 0;
  for (const child of node.children) {
    sum += countActionPaths(child);
  }
  return sum;
}

