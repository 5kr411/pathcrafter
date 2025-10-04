import { setLastMcData, setTargetItemNameGlobal } from './utils/context';
import { chooseMinimalToolName } from './utils/items';
import { renderName } from './utils/render';
import { computePathWeight } from './utils/pathUtils';
import * as treeBuild from './action_tree/build';
import * as treeLogger from './action_tree/logger';
import * as treeEnumerate from './action_tree/enumerate';
import * as treeMetrics from './action_tree/metrics';

const actionPathsGenerator = require('./path_generators/actionPathsGenerator');
const shortestPathsGenerator = require('./path_generators/shortestPathsGenerator');
const lowestWeightPathsGenerator = require('./path_generators/lowestWeightPathsGenerator');
import logger from './utils/logger';

function logActionTree(tree: any, depth: number = 1): void {
  if (!tree) return;
  const indent = ' '.repeat(depth * 2);
  if (tree.action === 'root') {
    const op = tree.operator === 'AND' ? 'ALL' : 'ANY';
    logger.info(`${indent}├─ ${tree.what} (want ${tree.count}) [${op}]`);
    const children = tree.children || [];
    children.forEach((child: any) => {
      logActionNode(child, depth + 1, false);
    });
    return;
  }
  logActionNode(tree, depth, true);
}

function logActionNode(node: any, depth: number, isLastAtThisLevel: boolean): void {
  const indent = ' '.repeat(depth * 2);
  const branch = isLastAtThisLevel ? '└─' : '├─';
  if (node.action === 'craft') {
    const op = node.operator === 'AND' ? 'ALL' : 'ANY';
    logger.info(`${indent}${branch} craft in ${node.what} (${node.count}x) [${op}]`);
    if (node.ingredients && node.ingredients.length > 0 && node.result) {
      const ingredientsStr = node.ingredients
        .map((i: any) => `${i.perCraftCount} ${renderName(i.item, i.meta)}`)
        .join(' + ');
      const resultName = renderName(node.result.item, node.result.meta);
      logger.info(`${' '.repeat((depth + 1) * 2)}├─ ${ingredientsStr} to ${node.result.perCraftCount} ${resultName}`);
    }
    const children = node.children || [];
    children.forEach((child: any) => logActionTree(child, depth + 2));
    return;
  }
  if (node.action === 'mine') {
    if (node.children && node.children.length > 0) {
      const op = node.operator === 'AND' ? 'ALL' : 'ANY';
      const targetInfo = node.what ? ` for ${renderName(node.what)}` : '';
      logger.info(`${indent}${branch} mine${targetInfo} (${node.count}x) [${op}]`);
      node.children.forEach((child: any) => {
        if (child.action === 'require') {
          logActionTree(child, depth + 1);
        } else {
          const subIndent = ' '.repeat((depth + 1) * 2);
          const subBranch = '├─';
          const toolInfo = child.tool && child.tool !== 'any' ? ` (needs ${child.tool})` : '';
          const childTargetInfo = child.targetItem ? ` for ${renderName(child.targetItem)}` : '';
          logger.info(`${subIndent}${subBranch} ${renderName(child.what)}${childTargetInfo}${toolInfo}`);
        }
      });
    } else {
      const targetInfo = node.targetItem ? ` for ${renderName(node.targetItem)}` : '';
      logger.info(`${indent}${branch} ${renderName(node.what)}${targetInfo}`);
    }
    return;
  }
  if (node.action === 'smelt') {
    if (node.children && node.children.length > 0) {
      const op = node.operator === 'AND' ? 'ALL' : 'ANY';
      const fuelInfo = node.fuel ? ` with ${renderName(node.fuel)}` : '';
      logger.info(`${indent}${branch} smelt in furnace${fuelInfo} (${node.count}x) [${op}]`);
      if (node.input && node.result) {
        const ingStr = `${node.input.perSmelt} ${renderName(node.input.item)}`;
        const resStr = `${node.result.perSmelt} ${renderName(node.result.item)}`;
        logger.info(`${' '.repeat((depth + 1) * 2)}├─ ${ingStr} to ${resStr}`);
      }
      node.children.forEach((child: any) => logActionTree(child, depth + 1));
    } else {
      logger.info(`${indent}${branch} smelt ${renderName(node.what)}`);
    }
    return;
  }
  if (node.action === 'require') {
    const op = node.operator === 'AND' ? 'ALL' : 'ANY';
    logger.info(`${indent}${branch} require ${node.what.replace('tool:', '')} [${op}]`);
    const children = node.children || [];
    children.forEach((child: any) => logActionTree(child, depth + 1));
    return;
  }
  if (node.action === 'hunt') {
    if (node.children && node.children.length > 0) {
      const op = node.operator === 'AND' ? 'ALL' : 'ANY';
      logger.info(`${indent}${branch} hunt (${node.count}x) [${op}]`);
      node.children.forEach((child: any) => {
        const subIndent = ' '.repeat((depth + 1) * 2);
        const subBranch = '├─';
        const chance = child.dropChance ? ` (${child.dropChance * 100}% chance)` : '';
        const toolInfo = child.tool && child.tool !== 'any' ? ` (needs ${child.tool})` : '';
        const targetInfo = child.targetItem ? ` for ${renderName(child.targetItem)}` : '';
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

interface AnalyzeRecipesFunction {
  (ctx: any, itemName: string, targetCount?: number, options?: any): any;
  _internals?: any;
}

const analyzeRecipes: AnalyzeRecipesFunction = (ctx: any, itemName: string, targetCount: number = 1, options: any = {}): any => {
  const mc = treeBuild.resolveMcData(ctx);
  setLastMcData(mc || null);
  setTargetItemNameGlobal(itemName);
  const tree = treeBuild.buildRecipeTree(mc, itemName, targetCount, {
    inventory: options && options.inventory ? options.inventory : undefined
  });
  if (!options || options.log !== false) treeLogger.logActionTree(tree);
  return tree;
};

function logActionPath(path: any[]): void {
  const parts = path.map((step) => {
    if (step.action === 'craft') {
      const ing =
        step.ingredients && step.ingredients.length > 0
          ? `${step.ingredients.map((i: any) => `${i.perCraftCount} ${renderName(i.item, i.meta)}`).join(' + ')} to `
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
  const weight = typeof computePathWeight === 'function' ? computePathWeight(path) : 0;
  logger.info(`${parts.join(' -> ')} (w=${weight})`);
}

function logActionPaths(paths: any[]): void {
  paths.forEach((p: any, idx: number) => {
    process.stdout.write(`#${idx + 1} `);
    logActionPath(p);
  });
}

analyzeRecipes._internals = {
  resolveMcData: treeBuild.resolveMcData,
  requiresCraftingTable: treeBuild.requiresCraftingTable,
  renderName,
  chooseMinimalToolName,
  findBlocksThatDrop: treeBuild.findBlocksThatDrop,
  printMiningPath: treeLogger.printMiningPath,
  getIngredientCounts: treeBuild.getIngredientCounts,
  hasCircularDependency: treeBuild.hasCircularDependency,
  printRecipeConversion: treeLogger.printRecipeConversion,
  findMobsThatDrop: treeBuild.findMobsThatDrop,
  printHuntingPath: treeLogger.printHuntingPath,
  buildRecipeTree: treeBuild.buildRecipeTree,
  logActionTree: treeLogger.logActionTree,
  enumerateActionPaths: treeEnumerate.enumerateActionPaths,
  enumerateShortestPathsGenerator: shortestPathsGenerator.enumerateShortestPathsGenerator,
  enumerateActionPathsGenerator: actionPathsGenerator.enumerateActionPathsGenerator,
  computeTreeMaxDepth: treeMetrics.computeTreeMaxDepth,
  countActionPaths: treeMetrics.countActionPaths,
  logActionPath,
  logActionPaths,
  computePathWeight,
  enumerateLowestWeightPathsGenerator: lowestWeightPathsGenerator.enumerateLowestWeightPathsGenerator
};

export default analyzeRecipes;

