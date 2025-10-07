import {
  TreeNode,
  ActionPath,
  ActionStep,
  CraftNode,
  MineLeafNode,
  SmeltNode,
  HuntLeafNode,
  VariantTreeNode,
  RootNode
} from './types';

/**
 * Enumerates all possible action paths from a recipe tree with variant-first approach
 * @param tree - The recipe tree to enumerate paths from
 * @returns Array of all possible action paths
 */
export function enumerateActionPaths(tree: TreeNode): ActionPath[] {
  return enumerateNode(tree as VariantTreeNode | null | undefined);
}

function enumerateNode(node: VariantTreeNode | null | undefined): ActionPath[] {
  if (!node) return [[]];

  switch (node.action) {
    case 'root':
      return enumerateRoot(node as RootNode);
    case 'craft':
      return enumerateCraftNode(node as CraftNode);
    case 'smelt':
      return enumerateSmeltNode(node as SmeltNode);
    case 'mine':
    case 'hunt':
      return enumerateGatherNode(node as MineLeafNode | HuntLeafNode);
    default:
      return [[]];
  }
}

function enumerateRoot(node: RootNode): ActionPath[] {
  const children = node.children.variants || [];
  if (children.length === 0) return [[]];

  if ((node as any).operator === 'AND') {
    return combineChildrenAsAnd(children).map(simplifyPath);
  }

  const paths: ActionPath[] = [];
  for (const child of children) {
    paths.push(...enumerateNode(child.value).map(simplifyPath));
  }

  return paths.length > 0 ? paths : [[]];
}

function enumerateCraftNode(node: CraftNode): ActionPath[] {
  const dependencies = node.children.variants || [];
  const dependencyPaths = combineChildrenAsAnd(dependencies);

  const craftStep: ActionStep = {
    action: 'craft',
    variantMode: node.variantMode,
    what: node.what,
    count: node.count,
    result: node.result,
    ingredients: node.ingredients
  };

  return dependencyPaths.map(path => path.concat([craftStep]));
}

function enumerateSmeltNode(node: SmeltNode): ActionPath[] {
  if ((node as any).operator === 'OR') {
    const children = node.children.variants || [];
    const paths: ActionPath[] = [];
    for (const child of children) {
      paths.push(...enumerateNode(child.value).map(simplifyPath));
    }
    return paths.length > 0 ? paths : [[]];
  }

  const dependencies = node.children.variants || [];
  const dependencyPaths = combineChildrenAsAnd(dependencies);

  const smeltStep: ActionStep = {
    action: 'smelt',
    variantMode: node.variantMode,
    what: node.what,
    count: node.count,
    input: node.input,
    result: node.result,
    fuel: node.fuel
  };

  return dependencyPaths.map(path => path.concat([smeltStep]));
}

function enumerateGatherNode(node: MineLeafNode | HuntLeafNode): ActionPath[] {
  const dependencies = node.children.variants || [];
  const dependencyPaths = combineChildrenAsAnd(dependencies);

  const gatherStep: ActionStep = cloneStep({
    action: node.action,
    variantMode: node.variantMode,
    what: node.what,
    count: node.count,
    dropChance: 'dropChance' in node ? node.dropChance : undefined,
    tool: node.tool,
    targetItem: node.targetItem
  });

  return dependencyPaths.map(path => simplifyPath(path.concat([gatherStep])));
}

function combineChildrenAsAnd(children: { value: VariantTreeNode | null | undefined }[]): ActionPath[] {
  let combined: ActionPath[] = [[]];

  for (const child of children) {
    const childPaths = enumerateNode(child.value);
    if (childPaths.length === 0) {
      continue;
    }

    const nextCombined: ActionPath[] = [];
    for (const prefix of combined) {
      for (const suffix of childPaths) {
        nextCombined.push(prefix.concat(suffix));
      }
    }
    combined = nextCombined;
  }

  return combined;
}

function simplifyPath(path: ActionPath): ActionPath {
  const result: ActionStep[] = [];

  path.forEach(step => {
    const stepClone = cloneStep(step);
    if (isGatherAction(stepClone.action)) {
      const existing = result.find(existingStep => gatherStepsEquivalent(existingStep, stepClone));
      if (existing) {
        const mergedCount = addCounts(existing.count, stepClone.count);
        if (typeof mergedCount !== 'undefined') {
          existing.count = mergedCount;
        }
        mergeVariantGroup(existing.what, stepClone.what);
        mergeVariantGroup(existing.targetItem, stepClone.targetItem);
        mergeVariantGroup(existing.tool, stepClone.tool);
        mergeVariantGroup(existing.dropChance, stepClone.dropChance);
        return;
      }
    }
    result.push(stepClone);
  });

  return result;
}

function isGatherAction(action: ActionStep['action']): boolean {
  return action === 'mine' || action === 'hunt';
}

function gatherStepsEquivalent(a: ActionStep, b: ActionStep): boolean {
  return (
    a.action === b.action &&
    serialiseVariantGroup(a.what) === serialiseVariantGroup(b.what) &&
    serialiseVariantGroup(a.targetItem) === serialiseVariantGroup(b.targetItem) &&
    serialiseVariantGroup(a.tool) === serialiseVariantGroup(b.tool) &&
    serialiseVariantGroup(a.dropChance) === serialiseVariantGroup(b.dropChance)
  );
}

function serialiseVariantGroup(group: any): string {
  if (!group) return '';
  const variants = (group.variants || []).map((v: any) => JSON.stringify(v.value)).sort();
  return `${group.mode}|${variants.join('|')}`;
}

function addCounts(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (typeof a === 'number') return a;
  if (typeof b === 'number') return b;
  return undefined;
}

function cloneStep(step: ActionStep): ActionStep {
  return {
    action: step.action,
    variantMode: step.variantMode,
    what: cloneVariantGroup(step.what),
    count: step.count,
    result: cloneVariantGroup(step.result),
    ingredients: cloneVariantGroup(step.ingredients),
    input: cloneVariantGroup(step.input),
    fuel: cloneVariantGroup(step.fuel),
    tool: cloneVariantGroup(step.tool),
    targetItem: cloneVariantGroup(step.targetItem),
    dropChance: cloneVariantGroup(step.dropChance)
  };
}

function cloneVariantGroup(group: any): any {
  if (!group) return undefined;
  return {
    mode: group.mode,
    variants: (group.variants || []).map((v: any) => ({
      value: cloneVariantValue(v.value),
      metadata: v.metadata ? { ...v.metadata } : undefined
    }))
  };
}

function cloneVariantValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(cloneVariantValue);
  }
  if (value && typeof value === 'object') {
    return { ...value };
  }
  return value;
}

function mergeVariantGroup(target: any, source: any): void {
  if (!target || !source) return;
  const existing = new Set((target.variants || []).map((v: any) => JSON.stringify(v.value)));
  (source.variants || []).forEach((variant: any) => {
    const key = JSON.stringify(variant.value);
    if (!existing.has(key)) {
      target.variants.push({
        value: cloneVariantValue(variant.value),
        metadata: variant.metadata ? { ...variant.metadata } : undefined
      });
      existing.add(key);
    }
  });
}

