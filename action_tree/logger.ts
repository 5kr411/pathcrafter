import {
  TreeNode,
  ActionPath,
  CraftNode,
  SmeltNode,
  RequireNode,
  VariantTreeNode
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

/**
 * Logs a single action node
 */
    function logActionNode(node: VariantTreeNode | any, depth: number, isLastAtThisLevel: boolean): void {
  const indent = ' '.repeat(depth * 2);
  const branch = isLastAtThisLevel ? '└─' : '├─';

  if (node.action === 'craft') {
    const craftNode = node as CraftNode;
    const op = craftNode.operator === 'AND' ? 'ALL' : 'ANY';
    const whatStr = craftNode.what.variants.map(v => v.value).join(', ');
    console.log(`${indent}${branch} craft in ${whatStr} (${craftNode.count}x) [${op}]`);

    if (craftNode.ingredients && craftNode.ingredients.variants.length > 0 && craftNode.result) {
      // Show first variant
      const firstIngredients = craftNode.ingredients.variants[0].value
        .map(i => `${i.perCraftCount} ${renderName(i.item, i.meta)}`)
        .join(' + ');
      const firstResult = craftNode.result.variants[0].value;
      const resultName = renderName(firstResult.item, firstResult.meta);
      
      let variantsInfo = '';
      if (craftNode.result.variants.length > 1) {
        // Show second variant if it exists
        if (craftNode.result.variants.length >= 2 && craftNode.ingredients.variants.length >= 2) {
          const secondIngredients = craftNode.ingredients.variants[1].value
            .map(i => `${i.perCraftCount} ${renderName(i.item, i.meta)}`)
            .join(' + ');
          const secondResult = craftNode.result.variants[1].value;
          const secondResultName = renderName(secondResult.item, secondResult.meta);
          variantsInfo = `, ${secondIngredients} to ${secondResult.perCraftCount} ${secondResultName}`;
          
          // Show "+x more" for remaining variants
          if (craftNode.result.variants.length > 2) {
            variantsInfo += `, +${craftNode.result.variants.length - 2} more`;
          }
        } else {
          variantsInfo = ` (+${craftNode.result.variants.length - 1} more)`;
        }
        
        // Add variant mode indicator
        const modeLabel = craftNode.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
        variantsInfo += ` [${modeLabel}]`;
      }
      
      console.log(`${' '.repeat((depth + 1) * 2)}├─ ${firstIngredients} to ${firstResult.perCraftCount} ${resultName}${variantsInfo}`);
    }

    const children = craftNode.children.variants || [];
        children.forEach((child: any) => logActionTree(child.value, depth + 2));
    return;
  }

  if (node.action === 'mine') {
    if (node.children && node.children.variants.length > 0) {
      const op = ('operator' in node && node.operator === 'OR') ? 'ANY' : 'ALL';
      
      // Check if children have variants to show in the header
      let targetInfo = '';
      let groupVariantsInfo = '';
      
          // Find first child with variants to extract the target list
          const firstChild = node.children.variants.find((c: any) => 
            c.value.action !== 'require' && c.value.targetItem && c.value.targetItem.variants.length > 1
          );
      
      if (firstChild) {
        // Show variants in the mine group header
        const firstTarget = firstChild.value.targetItem.variants[0].value;
        targetInfo = ` for ${renderName(firstTarget)}`;
        
        if (firstChild.value.targetItem.variants.length >= 2) {
          const secondTarget = firstChild.value.targetItem.variants[1].value;
          groupVariantsInfo = `, ${renderName(secondTarget)}`;
          
          if (firstChild.value.targetItem.variants.length > 2) {
            groupVariantsInfo += `, +${firstChild.value.targetItem.variants.length - 2} more`;
          }
        }
      } else {
        const whatStr = node.what.variants.map((v: any) => v.value).join(', ');
        targetInfo = ` for ${whatStr}`;
      }
      
      console.log(`${indent}${branch} mine${targetInfo}${groupVariantsInfo} (${node.count}x) [${op}]`);

      // Separate require nodes from mine leaves
      const requireNodes: any[] = [];
      const mineLeaves: any[] = [];
      
          node.children.variants.forEach((child: any) => {
            if (child.value.action === 'require') {
              requireNodes.push(child.value);
            } else {
              mineLeaves.push(child.value);
            }
          });
      
      // Print require nodes first
      requireNodes.forEach(child => {
        logActionTree(child, depth + 1);
      });
      
          // Print mine leaves - if they have variants, show them compactly
          mineLeaves.forEach((child: any, idx: any) => {
        const subIndent = ' '.repeat((depth + 1) * 2);
        const subBranch = idx === mineLeaves.length - 1 && requireNodes.length === 0 ? '└─' : '├─';
        const toolInfo = child.tool && child.tool.variants[0].value !== 'any' ? ` (needs ${child.tool.variants[0].value})` : '';
        
        // Check if this mine leaf has variants
        const whatVariants = child.what.variants;
        const targetItemVariants = child.targetItem?.variants;
        
        if (whatVariants && whatVariants.length > 1) {
          // Show variants compactly: "oak_log, spruce_log, +8 more"
          const firstBlock = renderName(whatVariants[0].value);
          const secondBlock = whatVariants.length >= 2 ? renderName(whatVariants[1].value) : '';
          const moreCount = whatVariants.length - 2;
          
          let blockInfo = firstBlock;
          if (secondBlock) {
            blockInfo += `, ${secondBlock}`;
          }
          if (moreCount > 0) {
            blockInfo += `, +${moreCount} more`;
          }
          
          // Only show "for X" if targets are different from blocks
          let targetInfo = '';
          if (targetItemVariants && targetItemVariants.length > 0) {
            // Check if targets differ from blocks
                const blockSet = new Set(whatVariants.map((v: any) => v.value));
                const targetSet = new Set(targetItemVariants.map((v: any) => v.value));
                const isDifferent = targetItemVariants.some((t: any) => !blockSet.has(t.value)) || whatVariants.some((b: any) => !targetSet.has(b.value));
            
            if (isDifferent) {
              const firstTarget = renderName(targetItemVariants[0].value);
              const secondTarget = targetItemVariants.length >= 2 ? renderName(targetItemVariants[1].value) : '';
              
              targetInfo = ` for ${firstTarget}`;
              if (secondTarget) {
                targetInfo += `, ${secondTarget}`;
              }
              if (targetItemVariants.length > 2) {
                targetInfo += `, +${targetItemVariants.length - 2} more`;
              }
            }
          }
          
          const modeLabel = child.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
          const modeInfo = ` [${modeLabel}]`;
          
          console.log(`${subIndent}${subBranch} ${blockInfo}${targetInfo}${toolInfo}${modeInfo}`);
        } else {
          // No variants - show normally
          const blockName = renderName(child.what.variants[0].value);
          const targetInfo = child.targetItem ? ` for ${renderName(child.targetItem.variants[0].value)}` : '';
          console.log(`${subIndent}${subBranch} ${blockName}${targetInfo}${toolInfo}`);
        }
      });
    } else {
      const targetInfo = node.targetItem ? ` for ${renderName(node.targetItem.variants[0].value)}` : '';
      
      let variantsInfo = '';
      if (node.what.variants.length > 1) {
        // Show second variant if it exists
        if (node.what.variants.length >= 2) {
          const secondWhat = renderName(node.what.variants[1].value);
          const secondTargetInfo = node.targetItem && node.targetItem.variants.length >= 2
            ? ` for ${renderName(node.targetItem.variants[1].value)}` 
            : '';
          variantsInfo = `, ${secondWhat}${secondTargetInfo}`;
          
          // Show "+x more" for remaining variants
          if (node.what.variants.length > 2) {
            variantsInfo += `, +${node.what.variants.length - 2} more`;
          }
        } else {
          variantsInfo = ` (+${node.what.variants.length - 1} more)`;
        }
        
        // Add variant mode indicator
        const modeLabel = node.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
        variantsInfo += ` [${modeLabel}]`;
      }
      
      console.log(`${indent}${branch} ${renderName(node.what.variants[0].value)}${targetInfo}${variantsInfo}`);
    }
    return;
  }

  if (node.action === 'smelt') {
    if (node.children && node.children.variants.length > 0) {
      const smeltNode = node as SmeltNode;
      const op = smeltNode.operator === 'AND' ? 'ALL' : 'ANY';
      const fuelInfo = smeltNode.fuel ? ` with ${renderName(smeltNode.fuel.variants[0].value)}` : '';
      console.log(`${indent}${branch} smelt in furnace${fuelInfo} (${smeltNode.count}x) [${op}]`);

      if (smeltNode.input && smeltNode.result) {
        const firstInput = smeltNode.input.variants[0].value;
        const firstResult = smeltNode.result.variants[0].value;
        const ingStr = `${firstInput.perSmelt} ${renderName(firstInput.item)}`;
        const resStr = `${firstResult.perSmelt} ${renderName(firstResult.item)}`;
        console.log(`${' '.repeat((depth + 1) * 2)}├─ ${ingStr} to ${resStr}`);
      }

          smeltNode.children.variants.forEach((child: any) => logActionTree(child.value, depth + 1));
    } else {
      console.log(`${indent}${branch} smelt ${renderName(node.what.variants[0].value)}`);
    }
    return;
  }

  if (node.action === 'require') {
    const requireNode = node as RequireNode;
    const op = requireNode.operator === 'AND' ? 'ALL' : 'ANY';
    const whatStr = requireNode.what.variants.map((v: any) => v.value).join(', ');
    console.log(`${indent}${branch} require ${whatStr.replace('tool:', '')} [${op}]`);
        const children = requireNode.children.variants || [];
        children.forEach((child: any) => logActionTree(child.value, depth + 1));
    return;
  }

  if (node.action === 'hunt') {
    if (node.children && node.children.variants.length > 0) {
      const op = ('operator' in node && node.operator === 'OR') ? 'ANY' : 'ALL';
      console.log(`${indent}${branch} hunt (${node.count}x) [${op}]`);

          node.children.variants.forEach((child: any, idx: any) => {
        const subIndent = ' '.repeat((depth + 1) * 2);
        const subBranch = idx === node.children.variants.length - 1 ? '└─' : '├─';
        const chance = child.value.dropChance ? ` (${child.value.dropChance.variants[0].value * 100}% chance)` : '';
        const toolInfo = child.value.tool && child.value.tool.variants[0].value !== 'any' ? ` (needs ${child.value.tool.variants[0].value})` : '';
        const targetInfo = child.value.targetItem ? ` for ${renderName(child.value.targetItem.variants[0].value)}` : '';
        console.log(`${subIndent}${subBranch} ${renderName(child.value.what.variants[0].value)}${targetInfo}${chance}${toolInfo}`);
      });
    } else {
      console.log(`${indent}${branch} ${renderName(node.what.variants[0].value)}`);
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

