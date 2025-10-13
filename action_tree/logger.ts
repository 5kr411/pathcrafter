import {
  TreeNode,
  ActionPath,
  CraftNode,
  VariantTreeNode,
  RootNode
} from './types';

import { renderName } from '../utils/render';
import * as pathUtils from '../utils/pathUtils';
import logger from '../utils/logger';

/**
 * Prints mining path information
 */
export function printMiningPath(sources: any[], depth: number, targetCount: number): void {
  if (sources.length === 0) return;
  logger.info(`${' '.repeat((depth + 1) * 2)}├─ mine (${targetCount}x)`);
  sources.forEach((source, index) => {
    const isLast = index === sources.length - 1;
    const toolInfo = source.tool === 'any' ? '' : ` (needs ${source.tool})`;
    logger.info(`${' '.repeat((depth + 2) * 2)}${isLast ? '└─' : '├─'} ${source.block}${toolInfo}`);
  });
}

/**
 * Prints recipe conversion information
 */
export function printRecipeConversion(
  mcData: any,
  ingredientCounts: Map<number, number>,
  recipe: any,
  itemName: string,
  depth: number
): void {
  const ingredientList = Array.from(ingredientCounts.entries())
    .sort(([idA], [idB]) => idA - idB)
    .map(([id, count]) => `${count} ${mcData.items[id].name}`)
    .join(' + ');
  logger.info(`${' '.repeat((depth + 2) * 2)}├─ ${ingredientList} to ${recipe.result.count} ${itemName}`);
}

/**
 * Prints hunting path information
 */
export function printHuntingPath(sources: any[], depth: number, targetCount: number): void {
  if (sources.length === 0) return;
  logger.info(`${' '.repeat((depth + 1) * 2)}├─ hunt (${targetCount}x)`);
  sources.forEach((source, index) => {
    const isLast = index === sources.length - 1;
    const chanceInfo = source.dropChance ? ` (${source.dropChance * 100}% chance)` : '';
    logger.info(`${' '.repeat((depth + 2) * 2)}${isLast ? '└─' : '├─'} ${source.mob}${chanceInfo}`);
  });
}

/**
 * Logs the action tree structure
 */
export function logActionTree(tree: TreeNode | null | undefined, depth: number = 1): void {
  if (!tree) return;

  const indent = ' '.repeat(depth * 2);

  if (tree.action === 'root') {
    const op = tree.operator === 'OR' ? 'ANY' : 'ALL';
    const whatStr = tree.what.variants.map(v => v.value).join(', ');
    console.log(`${indent}├─ ${whatStr} (want ${tree.count}) [${op}]`);
    const children = tree.children.variants || [];
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      logActionNode(child.value, depth + 1, isLast);
    });
    return;
  }

  logActionNode(tree, depth, true);
}

function formatVariantValues(values: any[], limit: number = 3): string {
  const seen = new Set<string>();
  const names: string[] = [];
  values.map(formatVariantDisplay).forEach(name => {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  });
  if (names.length <= limit) {
    return names.join(', ');
  }
  return `${names.slice(0, limit).join(', ')}, +${names.length - limit} more`;
}

function formatVariantList(group: any, limit: number = 3): string {
  if (!group || !group.variants || group.variants.length === 0) return '';
  const values = group.variants.map((v: any) => v.value);
  return formatVariantValues(values, limit);
}

function formatVariantDisplay(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(formatVariantDisplay).join(' + ');
  }
  if (value.item) {
    const count = value.perCraftCount ?? value.count ?? 1;
    return `${count} ${value.item}`;
  }
  return JSON.stringify(value);
}

function collectVariantValues(node: any, key: 'what' | 'targetItem', includeNested: boolean = true): any[] {
  const result: any[] = [];
  const seen = new Set<string>();

  function traverse(current: any) {
    if (!current) return;
    const group = current[key];
    if (group && group.variants) {
      group.variants.forEach((variant: any) => {
        const serialized = JSON.stringify(variant.value);
        if (!seen.has(serialized)) {
          seen.add(serialized);
          result.push(variant.value);
        }
      });
    }
    if (includeNested && current.children && current.children.variants) {
      current.children.variants.forEach((child: any) => traverse(child.value));
    }
  }

  traverse(node);
  return result;
}

function logActionNode(node: VariantTreeNode | any, depth: number, isLastAtThisLevel: boolean): void {
  const indent = ' '.repeat(depth * 2);
  const branch = isLastAtThisLevel ? '└─' : '├─';

  if ((node.action === 'mine' || node.action === 'hunt') && 'operator' in node && node.operator === 'OR') {
    const children = node.children?.variants || [];
    if (children.length === 1 && children[0].value?.action === node.action) {
      logActionNode(children[0].value, depth, isLastAtThisLevel);
      return;
    }
  }

  if (node.action === 'root' && (node as RootNode).context.depth > 0) {
    const root = node as RootNode;
    const label = formatVariantList(root.what);
    const mode = root.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
    console.log(`${indent}${branch} ${label || '(no variants)'} (want ${root.count}) [${mode}]`);
    (root.children.variants || []).forEach((child, idx) => logActionNode(child.value, depth + 1, idx === root.children.variants.length - 1));
    return;
  }

  if (node.action === 'craft') {
    const craftNode = node as CraftNode;
    const op = (craftNode as any).operator === 'AND' ? 'ALL' : 'ANY';
    const where = formatVariantList(craftNode.what, 3);
    console.log(`${indent}${branch} craft in ${where || 'unknown'} (${craftNode.count}x) [${op}]`);

    if (craftNode.ingredients && craftNode.ingredients.variants.length > 0 && craftNode.result) {
      const inputs = formatVariantList(craftNode.ingredients);
      const outputs = formatVariantList(craftNode.result);
      console.log(`${' '.repeat((depth + 1) * 2)}├─ ${inputs} → ${outputs}`);
    }

    (craftNode.children.variants || []).forEach((child: any, idx: number) => logActionNode(child.value, depth + 1, idx === craftNode.children.variants.length - 1));
    return;
  }

  if (node.action === 'mine') {
    let label = formatVariantList(node.what);
    let target = node.targetItem ? formatVariantList(node.targetItem) : '';

    if ('operator' in node && node.operator === 'OR') {
      const unionTarget = collectVariantValues(node, 'targetItem', false);
      if (unionTarget.length > 0) {
        label = formatVariantValues(unionTarget);
        target = '';
      } else {
        const unionWhat = collectVariantValues(node, 'what');
        if (unionWhat.length > 0) {
          label = formatVariantValues(unionWhat);
        }
      }
    }

    const toolInfo = node.tool && node.tool.variants[0].value !== 'any' ? ` (needs ${formatVariantList(node.tool)})` : '';
    const suffix = target ? ` for ${target}` : '';
    const variantCount = node.what?.variants?.length || 0;
    const mode = variantCount > 1 && node.variantMode ? ` [${node.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF'}]` : '';
    console.log(`${indent}${branch} mine ${label}${suffix}${toolInfo} (${node.count}x)${mode}`);
    (node.children.variants || []).forEach((child: any, idx: number) => logActionNode(child.value, depth + 1, idx === node.children.variants.length - 1));
    return;
  }

  if (node.action === 'hunt') {
    const label = formatVariantList(node.what);
    const target = node.targetItem ? formatVariantList(node.targetItem) : '';
    const toolInfo = node.tool && node.tool.variants[0].value !== 'any' ? ` (needs ${formatVariantList(node.tool)})` : '';
    const chance = node.dropChance ? ` (${formatVariantList(node.dropChance)})` : '';
    console.log(`${indent}${branch} hunt ${label}${target ? ` for ${target}` : ''}${chance}${toolInfo} (${node.count}x)`);
    (node.children.variants || []).forEach((child: any, idx: number) => logActionNode(child.value, depth + 1, idx === node.children.variants.length - 1));
    return;
  }

  if (node.action === 'smelt') {
    const label = formatVariantList(node.what);
    const fuel = node.fuel ? formatVariantList(node.fuel) : '';
    const inputStr = node.input ? formatVariantList(node.input) : '';
    const resultStr = node.result ? formatVariantList(node.result) : '';
    console.log(`${indent}${branch} smelt ${label}${fuel ? ` using ${fuel}` : ''} (${node.count}x)`);
    if (inputStr || resultStr) {
      if (inputStr) console.log(`${' '.repeat((depth + 1) * 2)}├─ ${inputStr}`);
      if (resultStr) console.log(`${' '.repeat((depth + 1) * 2)}└─ ${resultStr}`);
    }
    (node.children.variants || []).forEach((child: any, idx: number) => logActionNode(child.value, depth + 1, idx === node.children.variants.length - 1));
    return;
  }

  if (node.action === 'root') {
    const rootNode = node as RootNode;
    const label = formatVariantList(rootNode.what);
    const op = (rootNode as any).operator === 'AND' ? 'ALL' : 'ANY';
    console.log(`${indent}${branch} ${label || '(no variants)'} (want ${rootNode.count}) [${op}]`);
    (rootNode.children.variants || []).forEach((child: any, idx: number) => logActionNode(child.value, depth + 1, idx === (rootNode.children.variants.length - 1)));
    return;
  }

  const what = formatVariantList(node.what);
  console.log(`${indent}${branch} ${node.action} ${what}`);
}

/**
 * Logs a single action path
 */
export function logActionPath(path: ActionPath): void {
  const parts = path.map(step => {
    if (step.action === 'craft') {
      const ing = step.ingredients && step.ingredients.variants.length > 0
        ? `${step.ingredients.variants[0].value.map(i => `${i.perCraftCount} ${renderName(i.item, i.meta)}`).join(' + ')} to `
        : '';
      const res = step.result ? `${step.result.variants[0].value.perCraftCount} ${renderName(step.result.variants[0].value.item, step.result.variants[0].value.meta)}` : 'unknown';
      const whatStr = step.what.variants.map(v => v.value).join(', ');
      return `craft in ${whatStr} (${step.count}x): ${ing}${res}`;
    }

    if (step.action === 'smelt') {
      const ing = step.input ? `${step.input.variants[0].value.perSmelt} ${renderName(step.input.variants[0].value.item)}` : '';
      const res = step.result ? `${step.result.variants[0].value.perSmelt} ${renderName(step.result.variants[0].value.item)}` : 'unknown';
      const fuel = step.fuel ? ` with ${renderName(step.fuel.variants[0].value)}` : '';
      return `smelt in furnace${fuel} (${step.count}x): ${ing} to ${res}`;
    }

    if (step.action === 'require') {
      const whatStr = step.what.variants.map(v => v.value).join(', ');
      return `require ${whatStr.replace('tool:', '')}`;
    }

    if (step.action === 'mine') {
      const tool = step.tool && step.tool.variants[0].value !== 'any' ? `, needs ${step.tool.variants[0].value}` : '';
      const forWhat = step.targetItem ? ` for ${renderName(step.targetItem.variants[0].value)}` : '';
      const whatStr = step.what.variants.map(v => v.value).join(', ');
      return `mine ${whatStr}${forWhat} (${step.count}x${tool})`;
    }

    if (step.action === 'hunt') {
      const chance = step.dropChance ? `, ${step.dropChance.variants[0].value * 100}% chance` : '';
      const tool = step.tool && step.tool.variants[0].value !== 'any' ? `, needs ${step.tool.variants[0].value}` : '';
      const forWhat = step.targetItem ? ` for ${renderName(step.targetItem.variants[0].value)}` : '';
      const whatStr = step.what.variants.map(v => v.value).join(', ');
      return `hunt ${whatStr}${forWhat} (${step.count}x${chance}${tool})`;
    }

    const whatStr = step.what.variants.map(v => v.value).join(', ');
    return `${step.action} ${whatStr} (${step.count}x)`;
  });

  const weight = typeof pathUtils.computePathWeight === 'function' ? pathUtils.computePathWeight(path) : 0;
  logger.info(`${parts.join(' -> ')} (w=${weight})`);
}

/**
 * Logs multiple action paths
 */
export function logActionPaths(paths: ActionPath[]): void {
  paths.forEach((p, idx) => {
    process.stdout.write(`#${idx + 1} `);
    logActionPath(p);
  });
}

