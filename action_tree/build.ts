import * as fs from 'fs';
import * as path from 'path';
import {
  TreeNode,
  RootNode,
  CraftNode,
  MineGroupNode,
  MineLeafNode,
  SmeltGroupNode,
  SmeltNode,
  HuntGroupNode,
  HuntLeafNode,
  RequireNode,
  BuildContext,
  MinecraftData,
  MinecraftRecipe,
  BlockSource,
  MobSource
} from './types';

import { getFurnaceInputsFor, chooseMinimalFuelName, getSmeltsPerUnitForFuel } from '../utils/smeltingConfig';
import { chooseMinimalToolName, getSuffixTokenFromName } from '../utils/items';
import { makeSupplyFromInventory, mapToInventoryObject } from '../utils/inventory';
import { isPersistentItemName } from '../utils/persistence';
import { createWorldBudgetAccessors } from '../utils/worldBudget';

/**
 * Resolves Minecraft data from various input formats
 */
export function resolveMcData(ctx: any): MinecraftData | undefined {
  if (!ctx) return undefined;
  ensureMinecraftDataFeaturesFiles();

  let minecraftData: any;
  try {
    minecraftData = require('minecraft-data');
  } catch (err: any) {
    const isMissingFeatures = err && err.code === 'MODULE_NOT_FOUND' && /features\.json/.test(String(err.message || ''));
    if (isMissingFeatures) {
      ensureMinecraftDataFeaturesFiles();
      minecraftData = require('minecraft-data');
    } else {
      throw err;
    }
  }

  if (typeof ctx === 'string') return minecraftData(ctx);
  if (ctx.itemsByName && ctx.items && ctx.blocks && ctx.recipes) return ctx;
  if (typeof ctx === 'object' && ctx.version) return minecraftData(ctx.version);
  return undefined;
}

/**
 * Ensures that minecraft-data features files exist
 */
function ensureMinecraftDataFeaturesFiles(): void {
  const projectRoot = path.join(__dirname, '..');
  const candidates: string[] = [];

  candidates.push(path.join(projectRoot, 'node_modules', 'minecraft-data', 'minecraft-data', 'data'));
  candidates.push(path.join(projectRoot, 'node_modules', 'minecraft-data', 'data'));

  try {
    const resolved = require.resolve('minecraft-data/lib/supportsFeature.js');
    const modRoot = path.dirname(path.dirname(resolved));
    candidates.push(path.join(modRoot, '..', 'minecraft-data', 'data'));
    candidates.push(path.join(modRoot, 'minecraft-data', 'data'));
    candidates.push(path.join(modRoot, 'data'));
  } catch (_) {
    // Ignore error
  }

  const ensureAt = (baseDir: string, relPath: string): void => {
    const filePath = path.join(baseDir, relPath);
    const dir = path.dirname(filePath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {
      // Ignore error
    }
    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]');
      }
    } catch (_) {
      // Ignore error
    }
  };

  for (const base of candidates) {
    ensureAt(base, path.join('pc', 'common', 'features.json'));
    ensureAt(base, path.join('bedrock', 'common', 'features.json'));
  }
}

/**
 * Checks if a recipe requires a crafting table
 */
export function requiresCraftingTable(recipe: MinecraftRecipe): boolean {
  if (recipe.ingredients) return false;
  if (recipe.inShape) {
    const tooWide = recipe.inShape.some(row => row.length > 2);
    const tooTall = recipe.inShape.length > 2;
    return tooWide || tooTall;
  }
  return false;
}

/**
 * Gets the item name from an item ID
 */
function getItemName(mcData: MinecraftData, id: number): string {
  return mcData.items[id]?.name || String(id);
}

/**
 * Canonicalizes a shaped recipe for deduplication
 */
function canonicalizeShapedRecipe(mcData: MinecraftData, recipe: MinecraftRecipe): string {
  const rows = recipe.inShape || [];
  const canonRows = rows.map(row =>
    row.map(cell => {
      if (cell === null || cell === undefined) return 0;
      const name = getItemName(mcData, cell);
      return getSuffixTokenFromName(name);
    })
  );
  return JSON.stringify(canonRows);
}

/**
 * Canonicalizes a shapeless recipe for deduplication
 */
function canonicalizeShapelessRecipe(mcData: MinecraftData, recipe: MinecraftRecipe): string {
  const ids = (recipe.ingredients || []).filter((id): id is number => id !== null && id !== undefined);
  const canon = ids.map(id => getSuffixTokenFromName(getItemName(mcData, id))).sort();
  return JSON.stringify(canon);
}

/**
 * Deduplicates recipes for an item
 */
export function dedupeRecipesForItem(
  mcData: MinecraftData,
  itemId: number,
  preferFamilies: boolean = true
): MinecraftRecipe[] {
  const all = (mcData.recipes[itemId] || []);
  if (!preferFamilies) return all.slice();

  const shapedMap = new Map<string, MinecraftRecipe>();
  const shapelessMap = new Map<string, MinecraftRecipe>();

  for (const r of all) {
    if (r.inShape) {
      const key = canonicalizeShapedRecipe(mcData, r);
      if (!shapedMap.has(key)) shapedMap.set(key, r);
    } else if (r.ingredients) {
      const key = canonicalizeShapelessRecipe(mcData, r);
      if (!shapelessMap.has(key)) shapelessMap.set(key, r);
    } else {
      shapelessMap.set(Math.random() + '', r);
    }
  }

  return [...shapedMap.values(), ...shapelessMap.values()];
}

/**
 * Gets ingredient counts from a recipe
 */
export function getIngredientCounts(recipe: MinecraftRecipe): Map<number, number> {
  const ingredients = recipe.ingredients || recipe.inShape?.flat().filter((id): id is number => id !== null && id !== undefined);
  if (!ingredients) return new Map();

  const ingredientCounts = new Map<number, number>();
  [...ingredients].sort((a, b) => (a || 0) - (b || 0)).forEach(id => {
    if (id !== null && id !== undefined) {
      ingredientCounts.set(id, (ingredientCounts.get(id) || 0) + 1);
    }
  });
  return ingredientCounts;
}

/**
 * Checks if there's a circular dependency between items
 */
export function hasCircularDependency(mcData: MinecraftData, itemId: number, ingredientId: number): boolean {
  const ingredientRecipes = mcData.recipes[ingredientId] || [];
  return ingredientRecipes.some(r =>
    (r.ingredients && r.ingredients.includes(itemId)) ||
    (r.inShape && r.inShape.some(row => row.includes(itemId)))
  );
}

/**
 * Finds furnace smelt inputs for an item
 */
export function findFurnaceSmeltsForItem(mcData: MinecraftData, itemName: string): string[] {
  const inputs = getFurnaceInputsFor(itemName);
  return inputs.filter((n: string) => !!mcData.itemsByName[n]);
}

/**
 * Finds blocks that drop a specific item
 */
export function findBlocksThatDrop(mcData: MinecraftData, itemName: string): BlockSource[] {
  const sources: BlockSource[] = [];
  const item = mcData.itemsByName[itemName];
  if (!item) return sources;

  Object.values(mcData.blocks).forEach(block => {
    if (block.drops && block.drops.includes(item.id)) {
      sources.push({
        block: block.name,
        tool: block.harvestTools
          ? Object.keys(block.harvestTools).map(id => mcData.items[Number(id)]?.name || id).join('/')
          : 'any'
      });
    }
  });

  return sources;
}

/**
 * Finds mobs that drop a specific item
 */
export function findMobsThatDrop(mcData: MinecraftData, itemName: string): MobSource[] {
  const sources: MobSource[] = [];
  const item = mcData.itemsByName[itemName];
  if (!item) return sources;

  Object.entries(mcData.entityLoot || {}).forEach(([_entityId, lootTable]) => {
    if (lootTable && lootTable.drops) {
      const hasItem = lootTable.drops.some(drop => {
        const dropItemName = drop.item?.toLowerCase().replace(' ', '_');
        return dropItemName === itemName;
      });
      if (hasItem) {
        sources.push({
          mob: lootTable.entity,
          dropChance: lootTable.drops.find(d => d.item?.toLowerCase().replace(' ', '_') === itemName)?.dropChance
        });
      }
    }
  });

  return sources;
}

/**
 * Builds a recipe tree for acquiring a specific item
 */
export function buildRecipeTree(
  ctx: any,
  itemName: string,
  targetCount: number = 1,
  context: BuildContext = {}
): RootNode {
  const mcData = resolveMcData(ctx);
  const item = mcData?.itemsByName[itemName];

  const invObj = context && context.inventory && typeof context.inventory === 'object' ? context.inventory : null;
  const invMap = makeSupplyFromInventory(invObj);

  // Deduct from inventory if available
  if (invMap && invMap.size > 0 && targetCount > 0) {
    const have = invMap.get(itemName) || 0;
    if (have > 0) {
      const use = Math.min(have, targetCount);
      invMap.set(itemName, have - use);
      targetCount -= use;
    }
  }

  const root: RootNode = {
    action: 'root',
    operator: 'OR',
    what: itemName,
    count: targetCount,
    children: []
  };

  if (!mcData || !item) return root;
  if (targetCount <= 0) return root;

  const avoidTool = context.avoidTool;
  const visited = context.visited instanceof Set ? context.visited : new Set<string>();
  const preferMinimalTools = context.preferMinimalTools !== false;

  if (visited.has(itemName)) return root;

  const nextVisited = new Set(visited);
  nextVisited.add(itemName);

  let recipes = dedupeRecipesForItem(mcData, item.id, false).sort((a, b) => b.result.count - a.result.count);

  // Score and sort recipes by missing ingredients
  try {
    recipes = recipes
      .map(r => {
        const craftingsNeeded = Math.ceil(targetCount / r.result.count);
        const ingredientCounts = getIngredientCounts(r);
        let missingTotal = 0;

        for (const [ingredientId, count] of ingredientCounts.entries()) {
          const ingredientItem = mcData.items[ingredientId];
          if (!ingredientItem) continue;

          const ingName = ingredientItem.name;
          const totalNeeded = count * craftingsNeeded;
          const haveIng = invMap ? (invMap.get(ingName) || 0) : 0;
          const missing = Math.max(0, totalNeeded - haveIng);
          missingTotal += missing;
        }

        return { recipe: r, missingTotal };
      })
      .sort((a, b) => a.missingTotal - b.missingTotal || (b.recipe.result.count - a.recipe.result.count))
      .map(s => s.recipe as MinecraftRecipe);
  } catch (_) {
    // Keep original ordering on scoring failure
  }

  const worldBudget = (context && context.worldBudget && typeof context.worldBudget === 'object') ? context.worldBudget : undefined;
  const wb = createWorldBudgetAccessors(worldBudget);

  // Process crafting recipes
  recipes.forEach(recipe => {
    const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
    const ingredientCounts = getIngredientCounts(recipe);

    const craftNode: CraftNode = {
      action: 'craft',
      operator: 'AND',
      what: requiresCraftingTable(recipe) ? 'table' : 'inventory',
      count: craftingsNeeded,
      result: {
        item: itemName,
        perCraftCount: recipe.result.count
      },
      ingredients: Array.from(ingredientCounts.entries())
        .sort(([a], [b]) => a - b)
        .map(([id, count]) => {
          const ingName = mcData.items[id]?.name;
          return {
            item: ingName,
            perCraftCount: count
          };
        }),
      children: []
    };

    const recipeInv = new Map(invMap);
    let recipeFeasible = true;

    // Sort ingredients by missing amount (prefer satisfying what we have first)
    const plannedOrder = Array.from(ingredientCounts.entries())
      .map(([ingredientId, count]) => {
        const ingredientItem = mcData.items[ingredientId];
        const ingNameAlloc = ingredientItem ? ingredientItem.name : null;
        const totalNeeded = count * craftingsNeeded;
        const haveIngSnapshot = invMap ? (invMap.get(ingNameAlloc!) || 0) : 0;
        const missingSnapshot = Math.max(0, totalNeeded - haveIngSnapshot);
        return { ingredientId, count, missingSnapshot, totalNeeded };
      })
      .sort((a, b) => a.missingSnapshot - b.missingSnapshot || a.totalNeeded - b.totalNeeded);

    plannedOrder.forEach(({ ingredientId, count }) => {
      const ingredientItem = mcData.items[ingredientId];
      if (!ingredientItem) return;

      const ingNameAlloc = ingredientItem.name;
      const totalNeeded = count * craftingsNeeded;
      let neededAfterInv = totalNeeded;

      // Deduct from recipe inventory
      if (recipeInv && recipeInv.size > 0 && totalNeeded > 0) {
        const haveIng = recipeInv.get(ingNameAlloc);
        if (typeof haveIng === 'number' && haveIng > 0) {
          const take = Math.min(haveIng, totalNeeded);
          recipeInv.set(ingNameAlloc, haveIng - take);
          neededAfterInv -= take;
        }
      }

      if (neededAfterInv <= 0) return;

      // Handle circular dependencies with mining
      if (hasCircularDependency(mcData, item.id, ingredientId)) {
        const sources = findBlocksThatDrop(mcData, ingredientItem.name);
        if (sources.length > 0) {
          const neededCount = neededAfterInv;

          // World pruning
          if (worldBudget) {
            const sourceNames = sources.map(s => s.block);
            const totalAvail = wb.sum('blocks', sourceNames);
            if (!(totalAvail >= neededCount)) {
              recipeFeasible = false;
              return;
            }
          }

          const miningGroup: MineGroupNode = {
            action: 'mine',
            operator: 'OR',
            what: ingredientItem.name,
            count: neededCount,
            children: sources.flatMap(s => {
              if (!s.tool || s.tool === 'any') {
                const leafNode: MineLeafNode = {
                  action: 'mine',
                  what: s.block,
                  targetItem: ingredientItem.name,
                  count: neededCount,
                  children: []
                };
                return [leafNode];
              }

              let tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);

              // Prefer existing tools
              const existing = tools.filter(t => {
                if (!recipeInv) return false;
                const count = recipeInv.get(t);
                return typeof count === 'number' && count > 0;
              });
              if (existing.length > 0) {
                const chosen = (preferMinimalTools && existing.length > 1) ? chooseMinimalToolName(existing) : existing[0];
                if (!wb.can('blocks', s.block, neededCount)) return [];
                const leafNode: MineLeafNode = {
                  action: 'mine',
                  what: s.block,
                  targetItem: ingredientItem.name,
                  tool: chosen,
                  count: neededCount,
                  children: []
                };
                return [leafNode];
              }

              if (preferMinimalTools && tools.length > 1) {
                const minimalTool = chooseMinimalToolName(tools);
                if (minimalTool) tools = [minimalTool];
              }

              const toolNodes = tools.map(toolName => {
                if (!wb.can('blocks', s.block, neededCount)) return null;
                const mineLeaf: MineLeafNode = {
                  action: 'mine',
                  what: s.block,
                  targetItem: ingredientItem.name,
                  tool: toolName,
                  count: neededCount,
                  children: []
                };
                const requireNode: RequireNode = {
                  action: 'require',
                  operator: 'AND',
                  what: `tool:${toolName}`,
                  count: 1,
                  children: [
                    buildRecipeTree(mcData, toolName, 1, {
                      avoidTool: toolName,
                      visited: nextVisited,
                      preferMinimalTools,
                      inventory: mapToInventoryObject(recipeInv),
                      worldBudget,
                      combineSimilarNodes: context.combineSimilarNodes
                    }),
                    mineLeaf
                  ]
                };
                return requireNode as TreeNode;
              }).filter((n): n is TreeNode => n !== null);
              
              return toolNodes;
            })
          };

          craftNode.children.push(miningGroup);
        } else {
          recipeFeasible = false;
        }
      } else {
        // Recursively build ingredient tree
        const ingredientTree = buildRecipeTree(mcData, ingNameAlloc, neededAfterInv, {
          ...context,
          visited: nextVisited,
          preferMinimalTools,
          inventory: mapToInventoryObject(recipeInv),
          worldBudget
        });
        craftNode.children.push(ingredientTree);
      }
    });

    // Add craft node to root if feasible
    if (!recipeFeasible) {
      // Skip infeasible recipe
    } else if (craftNode.what === 'table') {
      const alreadyHaveTable = invMap && (invMap.get('crafting_table') || 0) > 0;
      if (alreadyHaveTable) {
        root.children.push(craftNode);
      } else {
        const requireTable: RequireNode = {
          action: 'require',
          operator: 'AND',
          what: 'crafting_table',
          count: 1,
          children: [
            buildRecipeTree(mcData, 'crafting_table', 1, {
              ...context,
              visited: nextVisited,
              inventory: mapToInventoryObject(invMap)
            }),
            craftNode
          ]
        };
        root.children.push(requireTable);
      }
    } else {
      root.children.push(craftNode);
    }
  });

  // Process smelting recipes
  const smeltInputs = findFurnaceSmeltsForItem(mcData, itemName);
  if (smeltInputs.length > 0) {
    const perSmelt = 1;
    const smeltsNeeded = Math.ceil(targetCount / perSmelt);
    const fuelName = chooseMinimalFuelName(mcData);
    const smeltsPerFuel = fuelName ? getSmeltsPerUnitForFuel(fuelName) : 0;
    let fuelTotal = fuelName && smeltsPerFuel > 0 ? Math.ceil(smeltsNeeded / smeltsPerFuel) : 0;

    if (fuelName && invMap && invMap.size > 0 && fuelTotal > 0) {
      const haveFuel = invMap.get(fuelName) || 0;
      if (haveFuel > 0) fuelTotal = Math.max(0, fuelTotal - haveFuel);
    }

    const smeltGroup: SmeltGroupNode = {
      action: 'smelt',
      operator: 'OR',
      what: itemName,
      count: targetCount,
      children: smeltInputs.map(inp => {
        let inputNeeded = smeltsNeeded;
        if (invMap && invMap.size > 0 && inputNeeded > 0) {
          const haveInp = invMap.get(inp) || 0;
          if (haveInp > 0) inputNeeded = Math.max(0, inputNeeded - haveInp);
        }

        const children: TreeNode[] = [];

        // Require furnace
        if (!(invMap && (invMap.get('furnace') || 0) > 0)) {
          children.push({
            action: 'require',
            operator: 'AND',
            what: 'furnace',
            count: 1,
            children: [
              buildRecipeTree(mcData, 'furnace', 1, {
                ...context,
                visited: nextVisited,
                inventory: mapToInventoryObject(invMap),
                worldBudget
              })
            ]
          } as RequireNode);
        }

        // Require fuel
        if (fuelName && fuelTotal > 0) {
          children.push(buildRecipeTree(mcData, fuelName, fuelTotal, {
            ...context,
            visited: nextVisited,
            inventory: mapToInventoryObject(invMap),
            worldBudget
          }));
        }

        // Require input
        if (inputNeeded > 0) {
          children.push(buildRecipeTree(mcData, inp, inputNeeded, {
            ...context,
            visited: nextVisited,
            inventory: mapToInventoryObject(invMap),
            worldBudget
          }));
        }

        const smeltNode: SmeltNode = {
          action: 'smelt',
          operator: 'AND',
          what: 'furnace',
          count: smeltsNeeded,
          input: { item: inp, perSmelt: 1 },
          result: { item: itemName, perSmelt: perSmelt },
          fuel: fuelName || null,
          children
        };
        return smeltNode;
      })
    };

    root.children.push(smeltGroup);
  }

  // Process mining paths
  const miningPaths = findBlocksThatDrop(mcData, itemName);
  if (miningPaths.length > 0) {
    let allowMineGroup = true;

    // Check world availability
    if (worldBudget) {
      const names = miningPaths.map(s => s.block);
      const totalAvail = wb.sum('blocks', names);
      if (!(totalAvail >= targetCount)) {
        allowMineGroup = false;
      }
    }

    const mineGroup: MineGroupNode = {
      action: 'mine',
      operator: 'OR',
      what: itemName,
      count: targetCount,
      children: miningPaths.flatMap(s => {
        if (!s.tool || s.tool === 'any') {
          if (!wb.can('blocks', s.block, targetCount)) return [];
          const leafNode: MineLeafNode = {
            action: 'mine',
            what: s.block,
            targetItem: itemName,
            count: targetCount,
            children: []
          };
          return [leafNode];
        }

        let tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);

        // Prefer existing tools
        const existing = tools.filter(t => {
          if (!invMap) return false;
          const count = invMap.get(t);
          return typeof count === 'number' && count > 0;
        });
        if (existing.length > 0) {
          const chosen = (preferMinimalTools && existing.length > 1) ? chooseMinimalToolName(existing) : existing[0];
          if (!wb.can('blocks', s.block, targetCount)) return [];
          const leafNode: MineLeafNode = {
            action: 'mine',
            what: s.block,
            targetItem: itemName,
            tool: chosen,
            count: targetCount,
            children: []
          };
          return [leafNode];
        }

        if (preferMinimalTools && tools.length > 1) {
          const minimalTool = chooseMinimalToolName(tools);
          if (minimalTool) tools = [minimalTool];
        }

        const toolNodes = tools.map(toolName => {
          if (!wb.can('blocks', s.block, targetCount)) return null;
          const mineLeaf: MineLeafNode = {
            action: 'mine',
            what: s.block,
            targetItem: itemName,
            tool: toolName,
            count: targetCount,
            children: []
          };
          const requireNode: RequireNode = {
            action: 'require',
            operator: 'AND',
            what: `tool:${toolName}`,
            count: 1,
            children: [
              buildRecipeTree(mcData, toolName, 1, {
                ...context,
                avoidTool: toolName,
                visited: nextVisited,
                preferMinimalTools,
                inventory: mapToInventoryObject(invMap),
                worldBudget
              }),
              mineLeaf
            ]
          };
          return requireNode as TreeNode;
        }).filter((n): n is TreeNode => n !== null);
        
        return toolNodes;
      })
    };

    if (allowMineGroup && mineGroup.children.length > 0) {
      root.children.push(mineGroup);
    }
  }

  // Process hunting paths
  const huntingPaths = findMobsThatDrop(mcData, itemName);
  if (huntingPaths.length > 0) {
    const huntGroup: HuntGroupNode = {
      action: 'hunt',
      operator: 'OR',
      what: itemName,
      count: targetCount,
      children: huntingPaths.map(s => {
        const p = s.dropChance && s.dropChance > 0 ? s.dropChance : 1;
        const expectedKills = Math.ceil(targetCount / p);

        if (!wb.can('entities', s.mob, expectedKills)) return null;

        const huntLeaf: HuntLeafNode = {
          action: 'hunt',
          what: s.mob,
          targetItem: itemName,
          count: expectedKills,
          dropChance: s.dropChance,
          children: []
        };
        return huntLeaf;
      }).filter((n): n is HuntLeafNode => n !== null)
    };

    // Only add hunt group if it has valid children
    if (huntGroup.children.length > 0) {
      root.children.push(huntGroup);
    }
  }

  // Normalize persistent requirements
  try {
    normalizePersistentRequires(root, context && context.inventory ? context.inventory : null);
  } catch (_) {
    // Ignore normalization errors
  }

  // Combine similar nodes if enabled
  if (context && context.combineSimilarNodes && mcData) {
    try {
      combineSimilarNodesInTree(mcData, root);
    } catch (_) {
      // Ignore combination errors
    }
  }

  return root;
}

/**
 * Hoists and dedupes persistent requires inside AND contexts
 */
function normalizePersistentRequires(node: TreeNode, invObj: Record<string, number> | null): void {
  if (!node || !node.children || node.children.length === 0) return;

  const isAndContext = node.action === 'craft' || node.action === 'require' || ('operator' in node && node.operator === 'AND');
  if (isAndContext) {
    const children = node.children;
    const firstRequireByWhat = new Map<string, number>();

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child || child.action !== 'require' || child.operator !== 'AND') continue;

      const what = String(child.what || '');
      const parts = what.startsWith('tool:') ? what.slice('tool:'.length) : what;
      const isPersistent = isPersistentItemName(parts);
      if (!isPersistent) continue;

      const hasContinuation = Array.isArray(child.children) && child.children.length >= 2;
      const invHas = invObj && typeof invObj === 'object' ? ((invObj[parts] || 0) > 0) : false;

      if (invHas && hasContinuation) {
        // Inventory already satisfies; drop acquisition and keep continuation
        children[i] = child.children[1];
        i--; // Re-check this position
        continue;
      }

      if (!hasContinuation) continue;

      if (!firstRequireByWhat.has(what)) {
        firstRequireByWhat.set(what, i);
      } else {
        // Duplicate require; keep only continuation
        children[i] = child.children[1];
        i--;
      }
    }
  }

  // Recurse
  for (const ch of node.children) {
    normalizePersistentRequires(ch, invObj);
  }
}

/**
 * Groups similar craft nodes based on recipe shape and suffix
 * Returns grouped nodes with variants tracked
 */
function groupSimilarCraftNodes(_mcData: MinecraftData, nodes: TreeNode[]): TreeNode[] {
  const craftNodes = nodes.filter((n): n is CraftNode => n.action === 'craft');
  const otherNodes = nodes.filter(n => n.action !== 'craft');

  if (craftNodes.length === 0) return nodes;

  // Group by recipe shape (canonical representation)
  const groupsByShape = new Map<string, CraftNode[]>();

  for (const node of craftNodes) {
    // Build a canonical key based on:
    // 1. Crafting location (table vs inventory)
    // 2. Number and suffix of ingredients
    // 3. Recipe shape
    const ingredientSuffixes = node.ingredients
      .map(ing => getSuffixTokenFromName(ing.item))
      .sort()
      .join(',');
    const resultSuffix = getSuffixTokenFromName(node.result.item);
    const key = `${node.what}:${ingredientSuffixes}:${resultSuffix}:${node.result.perCraftCount}`;

    if (!groupsByShape.has(key)) {
      groupsByShape.set(key, []);
    }
    groupsByShape.get(key)!.push(node);
  }

  // Combine groups with multiple variants
  const combinedNodes: TreeNode[] = [];

  for (const [_key, group] of groupsByShape.entries()) {
    if (group.length === 1) {
      // No combining needed
      combinedNodes.push(group[0]);
    } else {
      // Combine into one representative node
      const representative = { ...group[0] };
      representative.resultVariants = group.map(n => n.result.item);
      representative.ingredientVariants = group.map(n => n.ingredients.map(ing => ing.item));
      representative.variantMode = 'one_of'; // Wood families are mutually exclusive
      
      // Merge children from all variants
      representative.children = mergeChildrenFromVariants(_mcData, group);
      
      combinedNodes.push(representative);
    }
  }

  return [...combinedNodes, ...otherNodes];
}

/**
 * Merges children subtrees from multiple craft node variants
 * This ensures that ingredient acquisition paths are combined across wood families
 */
function mergeChildrenFromVariants(_mcData: MinecraftData, variants: CraftNode[]): TreeNode[] {
  if (variants.length === 0) return [];
  if (variants.length === 1) return variants[0].children;

  // Collect all children from all variants
  const allChildren: TreeNode[] = [];
  for (const variant of variants) {
    allChildren.push(...variant.children);
  }

  // Group children by their suffix (to merge wood families)
  const childrenBySuffix = new Map<string, TreeNode[]>();
  
  for (const child of allChildren) {
    // Root nodes have a 'what' field indicating what item they acquire
    if (child.action === 'root') {
      // Group by suffix to merge oak_planks, spruce_planks, etc.
      const suffix = getSuffixTokenFromName(child.what);
      if (!childrenBySuffix.has(suffix)) {
        childrenBySuffix.set(suffix, []);
      }
      childrenBySuffix.get(suffix)!.push(child);
    } else {
      // Non-root children get a unique key based on their type
      const key = `${child.action}:${child.what}`;
      if (!childrenBySuffix.has(key)) {
        childrenBySuffix.set(key, []);
      }
      childrenBySuffix.get(key)!.push(child);
    }
  }

  // Merge children with the same suffix
  const mergedChildren: TreeNode[] = [];
  
  for (const [_suffix, childGroup] of childrenBySuffix.entries()) {
    if (childGroup.length === 1) {
      mergedChildren.push(childGroup[0]);
    } else if (childGroup[0].action === 'root') {
      // Merge multiple root nodes by combining their children
      const mergedRoot: RootNode = { ...childGroup[0] } as RootNode;
      
      // Use the first node's name but track all variants
      // This represents "acquire any _planks type"
      
      // Collect all children from all root variants
      const allRootChildren: TreeNode[] = [];
      for (const rootNode of childGroup) {
        allRootChildren.push(...rootNode.children);
      }
      
      // Recursively combine the children (craft nodes, mine nodes, etc.)
      const combinedRootChildren = groupSimilarCraftNodes(_mcData, allRootChildren);
      
      // Group mine groups by their target item and merge them
      mergedRoot.children = groupMineGroups(combinedRootChildren);
      
      mergedChildren.push(mergedRoot);
    } else {
      // For non-root nodes, just take the first one
      mergedChildren.push(childGroup[0]);
    }
  }

  return mergedChildren;
}

/**
 * Groups mine group nodes by their target item suffix and merges their leaves
 */
function groupMineGroups(nodes: TreeNode[]): TreeNode[] {
  const mineGroups = nodes.filter((n): n is MineGroupNode => 
    n.action === 'mine' && 'operator' in n && n.operator === 'OR'
  );
  const otherNodes = nodes.filter(n => 
    !(n.action === 'mine' && 'operator' in n && n.operator === 'OR')
  );

  if (mineGroups.length === 0) return nodes;

  // Group mine groups by their target item suffix
  const groupsBySuffix = new Map<string, MineGroupNode[]>();

  for (const mineGroup of mineGroups) {
    const suffix = mineGroup.what ? getSuffixTokenFromName(mineGroup.what) : 'default';
    if (!groupsBySuffix.has(suffix)) {
      groupsBySuffix.set(suffix, []);
    }
    groupsBySuffix.get(suffix)!.push(mineGroup);
  }

  // Merge mine groups with the same suffix
  const mergedMineGroups: TreeNode[] = [];

  for (const [_suffix, group] of groupsBySuffix.entries()) {
    if (group.length === 1) {
      // Single mine group - just combine its leaf nodes
      const mineGroup = group[0];
      mineGroup.children = groupSimilarMineLeafNodes(mineGroup.children);
      mergedMineGroups.push(mineGroup);
    } else {
      // Multiple mine groups - merge them
      const representative: MineGroupNode = { ...group[0] };
      
      // Collect all leaf nodes from all mine groups
      const allLeaves: TreeNode[] = [];
      for (const mineGroup of group) {
        allLeaves.push(...mineGroup.children);
      }
      
      // Group and merge the leaves
      representative.children = groupSimilarMineLeafNodes(allLeaves);
      
      mergedMineGroups.push(representative);
    }
  }

  return [...mergedMineGroups, ...otherNodes];
}

/**
 * Groups similar mine leaf nodes within a mine group
 */
function groupSimilarMineLeafNodes(nodes: TreeNode[]): TreeNode[] {
  const mineLeaves = nodes.filter((n): n is MineLeafNode => 
    n.action === 'mine' && (!('operator' in n) || !n.operator)
  );
  const otherNodes = nodes.filter(n => 
    n.action !== 'mine' || ('operator' in n && n.operator)
  );

  if (mineLeaves.length === 0) return nodes;

  // Group by tool and suffix
  const groupsByPattern = new Map<string, MineLeafNode[]>();

  for (const node of mineLeaves) {
    const blockSuffix = getSuffixTokenFromName(node.what);
    const targetSuffix = node.targetItem ? getSuffixTokenFromName(node.targetItem) : '';
    const tool = node.tool || 'none';
    const key = `${tool}:${blockSuffix}:${targetSuffix}`;

    if (!groupsByPattern.has(key)) {
      groupsByPattern.set(key, []);
    }
    groupsByPattern.get(key)!.push(node);
  }

  // Combine groups with multiple variants
  const combinedNodes: TreeNode[] = [];

  for (const [_key, group] of groupsByPattern.entries()) {
    if (group.length === 1) {
      combinedNodes.push(group[0]);
    } else {
      // Combine into one representative node
      const representative: MineLeafNode = { ...group[0] };
      representative.whatVariants = group.map(n => n.what);
      representative.targetItemVariants = group.map(n => n.targetItem || n.what);
      representative.variantMode = 'one_of'; // Block variants are mutually exclusive
      combinedNodes.push(representative);
    }
  }

  return [...combinedNodes, ...otherNodes];
}

/**
 * Recursively combines similar nodes throughout the tree
 */
function combineSimilarNodesInTree(mcData: MinecraftData, node: TreeNode): void {
  if (!node || !node.children || node.children.length === 0) return;

  // Recurse first
  for (const child of node.children) {
    combineSimilarNodesInTree(mcData, child);
  }

  // Then combine at this level
  if (node.action === 'root') {
    // Combine craft nodes at root level
    node.children = groupSimilarCraftNodes(mcData, node.children);
  } else if (node.action === 'mine' && 'operator' in node && node.operator === 'OR') {
    // Group mine leaf nodes within mine groups
    node.children = groupSimilarMineLeafNodes(node.children);
  } else if (node.action === 'craft') {
    // Combine child mine groups
    node.children = node.children.map(child => {
      if (child.action === 'mine' && 'operator' in child && child.operator === 'OR') {
        child.children = groupSimilarMineLeafNodes(child.children);
      }
      return child;
    });
  }
}

