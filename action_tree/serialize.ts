import { TreeNode, BuildContext, VariantConstraintManager } from './types';

/**
 * Serializes a tree node for worker thread transfer
 * Converts Maps and Sets to plain objects/arrays that can be cloned by structured clone
 */
export function serializeTree(node: TreeNode | null | undefined): any {
  if (!node) return null;

  const serialized: any = { ...node };

  if (node.context) {
    serialized.context = serializeContext(node.context);
  }

  if (node.children) {
    serialized.children = {
      ...node.children,
      variants: node.children.variants?.map((child: any) => serializeTree(child))
    };
  }

  if (node.variants) {
    serialized.variants = {
      ...node.variants,
      variants: node.variants.variants?.map((variant: any) => serializeTree(variant))
    };
  }

  return serialized;
}

/**
 * Deserializes a tree node received from worker thread
 * Converts plain objects/arrays back to Maps and Sets
 */
export function deserializeTree(serialized: any): TreeNode | null {
  if (!serialized) return null;

  const node: any = { ...serialized };

  if (serialized.context) {
    node.context = deserializeContext(serialized.context);
  }

  if (serialized.children?.variants) {
    node.children = {
      ...serialized.children,
      variants: serialized.children.variants.map((child: any) => deserializeTree(child))
    };
  }

  if (serialized.variants?.variants) {
    node.variants = {
      ...serialized.variants,
      variants: serialized.variants.variants.map((variant: any) => deserializeTree(variant))
    };
  }

  return node as TreeNode;
}

/**
 * Serializes BuildContext for worker transfer
 */
function serializeContext(context: BuildContext): any {
  return {
    ...context,
    inventory: context.inventory ? Array.from(context.inventory.entries()) : [],
    visited: Array.from(context.visited),
    variantConstraints: serializeVariantConstraints(context.variantConstraints)
  };
}

/**
 * Deserializes BuildContext from worker transfer
 */
function deserializeContext(serialized: any): BuildContext {
  return {
    ...serialized,
    inventory: new Map(serialized.inventory || []),
    visited: new Set(serialized.visited || []),
    variantConstraints: deserializeVariantConstraints(serialized.variantConstraints)
  };
}

/**
 * Serializes VariantConstraintManager for worker transfer
 */
function serializeVariantConstraints(manager: VariantConstraintManager): any {
  return manager.toJSON();
}

/**
 * Deserializes VariantConstraintManager from worker transfer
 */
function deserializeVariantConstraints(serialized: any): VariantConstraintManager {
  return VariantConstraintManager.fromJSON(serialized);
}

