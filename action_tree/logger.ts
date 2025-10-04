import {
  TreeNode,
  ActionPath,
  CraftNode,
  SmeltNode,
  RequireNode
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
    logger.info(`${indent}├─ ${tree.what} (want ${tree.count}) [${op}]`);
    const children = tree.children || [];
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      logActionNode(child, depth + 1, isLast);
    });
    return;
  }

  logActionNode(tree, depth, true);
}

/**
 * Logs a single action node
 */
function logActionNode(node: TreeNode, depth: number, isLastAtThisLevel: boolean): void {
  const indent = ' '.repeat(depth * 2);
  const branch = isLastAtThisLevel ? '└─' : '├─';

  if (node.action === 'craft') {
    const craftNode = node as CraftNode;
    const op = craftNode.operator === 'AND' ? 'ALL' : 'ANY';
    logger.info(`${indent}${branch} craft in ${craftNode.what} (${craftNode.count}x) [${op}]`);

    if (craftNode.ingredients && craftNode.ingredients.length > 0 && craftNode.result) {
      const ingredientsStr = craftNode.ingredients
        .map(i => `${i.perCraftCount} ${renderName(i.item, i.meta)}`)
        .join(' + ');
      const resultName = renderName(craftNode.result.item, craftNode.result.meta);
      logger.info(`${' '.repeat((depth + 1) * 2)}├─ ${ingredientsStr} to ${craftNode.result.perCraftCount} ${resultName}`);
    }

    const children = craftNode.children || [];
    children.forEach((child) => logActionTree(child, depth + 2));
    return;
  }

  if (node.action === 'mine') {
    if (node.children && node.children.length > 0) {
      const op = ('operator' in node && node.operator === 'OR') ? 'ANY' : 'ALL';
      const targetInfo = node.what ? ` for ${renderName(node.what)}` : '';
      logger.info(`${indent}${branch} mine${targetInfo} (${node.count}x) [${op}]`);

      node.children.forEach((child, idx) => {
        if (child.action === 'require') {
          logActionTree(child, depth + 1);
        } else {
          const subIndent = ' '.repeat((depth + 1) * 2);
          const subBranch = idx === node.children.length - 1 ? '└─' : '├─';
          const toolInfo = (child as any).tool && (child as any).tool !== 'any' ? ` (needs ${(child as any).tool})` : '';
          const childTargetInfo = (child as any).targetItem ? ` for ${renderName((child as any).targetItem)}` : '';
          logger.info(`${subIndent}${subBranch} ${renderName(child.what)}${childTargetInfo}${toolInfo}`);
        }
      });
    } else {
      const targetInfo = (node as any).targetItem ? ` for ${renderName((node as any).targetItem)}` : '';
      logger.info(`${indent}${branch} ${renderName(node.what)}${targetInfo}`);
    }
    return;
  }

  if (node.action === 'smelt') {
    if (node.children && node.children.length > 0) {
      const smeltNode = node as SmeltNode;
      const op = smeltNode.operator === 'AND' ? 'ALL' : 'ANY';
      const fuelInfo = smeltNode.fuel ? ` with ${renderName(smeltNode.fuel)}` : '';
      logger.info(`${indent}${branch} smelt in furnace${fuelInfo} (${smeltNode.count}x) [${op}]`);

      if (smeltNode.input && smeltNode.result) {
        const ingStr = `${smeltNode.input.perSmelt} ${renderName(smeltNode.input.item)}`;
        const resStr = `${smeltNode.result.perSmelt} ${renderName(smeltNode.result.item)}`;
        logger.info(`${' '.repeat((depth + 1) * 2)}├─ ${ingStr} to ${resStr}`);
      }

      smeltNode.children.forEach((child) => logActionTree(child, depth + 1));
    } else {
      logger.info(`${indent}${branch} smelt ${renderName(node.what)}`);
    }
    return;
  }

  if (node.action === 'require') {
    const requireNode = node as RequireNode;
    const op = requireNode.operator === 'AND' ? 'ALL' : 'ANY';
    logger.info(`${indent}${branch} require ${requireNode.what.replace('tool:', '')} [${op}]`);
    const children = requireNode.children || [];
    children.forEach((child) => logActionTree(child, depth + 1));
    return;
  }

  if (node.action === 'hunt') {
    if (node.children && node.children.length > 0) {
      const op = ('operator' in node && node.operator === 'OR') ? 'ANY' : 'ALL';
      logger.info(`${indent}${branch} hunt (${node.count}x) [${op}]`);

      node.children.forEach((child, idx) => {
        const subIndent = ' '.repeat((depth + 1) * 2);
        const subBranch = idx === node.children.length - 1 ? '└─' : '├─';
        const chance = (child as any).dropChance ? ` (${(child as any).dropChance * 100}% chance)` : '';
        const toolInfo = (child as any).tool && (child as any).tool !== 'any' ? ` (needs ${(child as any).tool})` : '';
        const targetInfo = (child as any).targetItem ? ` for ${renderName((child as any).targetItem)}` : '';
        logger.info(`${subIndent}${subBranch} ${renderName(child.what)}${targetInfo}${chance}${toolInfo}`);
      });
    } else {
      logger.info(`${indent}${branch} ${renderName(node.what)}`);
    }
    return;
  }

  if (node.action === 'root') {
    logActionTree(node, depth);
  }
}

/**
 * Logs a single action path
 */
export function logActionPath(path: ActionPath): void {
  const parts = path.map(step => {
    if (step.action === 'craft') {
      const ing = step.ingredients && step.ingredients.length > 0
        ? `${step.ingredients.map(i => `${i.perCraftCount} ${renderName(i.item, i.meta)}`).join(' + ')} to `
        : '';
      const res = step.result ? `${step.result.perCraftCount} ${renderName(step.result.item, step.result.meta)}` : 'unknown';
      return `craft in ${step.what} (${step.count}x): ${ing}${res}`;
    }

    if (step.action === 'smelt') {
      const ing = step.input ? `${step.input.perSmelt} ${renderName(step.input.item)}` : '';
      const res = step.result ? `${step.result.perSmelt} ${renderName(step.result.item)}` : 'unknown';
      const fuel = step.fuel ? ` with ${renderName(step.fuel)}` : '';
      return `smelt in furnace${fuel} (${step.count}x): ${ing} to ${res}`;
    }

    if (step.action === 'require') {
      return `require ${String(step.what).replace('tool:', '')}`;
    }

    if (step.action === 'mine') {
      const tool = step.tool && step.tool !== 'any' ? `, needs ${step.tool}` : '';
      const forWhat = step.targetItem ? ` for ${renderName(step.targetItem)}` : '';
      return `mine ${renderName(step.what)}${forWhat} (${step.count}x${tool})`;
    }

    if (step.action === 'hunt') {
      const chance = step.dropChance ? `, ${step.dropChance * 100}% chance` : '';
      const tool = step.tool && step.tool !== 'any' ? `, needs ${step.tool}` : '';
      const forWhat = step.targetItem ? ` for ${renderName(step.targetItem)}` : '';
      return `hunt ${renderName(step.what)}${forWhat} (${step.count}x${chance}${tool})`;
    }

    return `${step.action} ${renderName(step.what)} (${step.count}x)`;
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

