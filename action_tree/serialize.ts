import { TreeNode, BuildContext, VariantConstraintManager } from './types';

/**
 * Serializes a tree node for worker thread transfer
 * Converts Maps and Sets to plain objects/arrays that can be cloned by structured clone
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
export function serializeTree(node: TreeNode | null | undefined): any {
  if (!node) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  const serialized: any = { ...node };

  if (node.context) {
    serialized.context = serializeContext(node.context);
  }

  if (node.children) {
    serialized.children = {
      ...node.children,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
      variants: node.children.variants?.map((child: any) => serializeTree(child))
    };
  }

  if (node.variants) {
    serialized.variants = {
      ...node.variants,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
      variants: node.variants.variants?.map((variant: any) => serializeTree(variant))
    };
  }

  return serialized;
}

/**
 * Deserializes a tree node received from worker thread
 * Converts plain objects/arrays back to Maps and Sets
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
export function deserializeTree(serialized: any): TreeNode | null {
  if (!serialized) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  const node: any = { ...serialized };

  if (serialized.context) {
    node.context = deserializeContext(serialized.context);
  }

  if (serialized.children?.variants) {
    node.children = {
      ...serialized.children,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
      variants: serialized.children.variants.map((child: any) => deserializeTree(child))
    };
  }

  if (serialized.variants?.variants) {
    node.variants = {
      ...serialized.variants,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
      variants: serialized.variants.variants.map((variant: any) => deserializeTree(variant))
    };
  }

  return node as TreeNode;
}

/**
 * Serializes BuildContext for worker transfer
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
function serializeVariantConstraints(manager: VariantConstraintManager): any {
  return manager.toJSON();
}

/**
 * Deserializes VariantConstraintManager from worker transfer
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
function deserializeVariantConstraints(serialized: any): VariantConstraintManager {
  return VariantConstraintManager.fromJSON(serialized);
}

