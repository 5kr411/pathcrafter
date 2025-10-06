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
 * Gets a canonical key for a recipe based on its shape/structure (ignoring specific wood types)
 */
function getRecipeCanonicalKey(recipe: MinecraftRecipe): string {
  // Combine info about the recipe type and requirements
  const tableRequired = requiresCraftingTable(recipe);
  const resultCount = recipe.result?.count || 1;
  
  if (recipe.inShape) {
    // For shaped recipes, use the shape pattern
    const shapeKey = JSON.stringify(recipe.inShape?.map(row => row.map(cell => cell === null ? 0 : 1)));
    return `shaped:${tableRequired}:${resultCount}:${shapeKey}`;
  } else if (recipe.ingredients) {
    // For shapeless recipes, use sorted ingredient count
    const ingredientCount = recipe.ingredients.length;
    return `shapeless:${tableRequired}:${resultCount}:${ingredientCount}`;
  }
  
  return `other:${tableRequired}:${resultCount}`;
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
 * Finds all items similar to the given item (same suffix AND should be combinable)
 * Only groups items that are part of known families (wood types, nether wood types, bamboo)
 */
function findSimilarItems(mcData: MinecraftData, itemName: string): string[] {
  const suffix = getSuffixTokenFromName(itemName);
  if (!suffix) return [itemName];
  
  // Known combinable suffixes (wood families)
  const combinableSuffixes = new Set([
    'log', 'wood', 'planks', 'stem', 'hyphae',
    'button', 'door', 'fence', 'fence_gate', 'pressure_plate',
    'sign', 'slab', 'stairs', 'trapdoor', 'boat', 'chest_boat'
  ]);
  
  // Only combine if this is a combinable suffix
  if (!combinableSuffixes.has(suffix)) {
    return [itemName];
  }
  
  // Find all items with same suffix
  const similar: string[] = [];
  for (const name of Object.keys(mcData.itemsByName)) {
    if (getSuffixTokenFromName(name) === suffix) {
      // Additional check: both items should have the same prefix pattern
      // (oak_planks and spruce_planks both have wood type prefix + underscore + suffix)
      const itemParts = itemName.split('_');
      const nameParts = name.split('_');
      if (itemParts.length === nameParts.length) {
        similar.push(name);
      }
    }
  }
  
  return similar.length > 1 ? similar : [itemName];
}

/**
 * Builds a recipe tree for acquiring a specific item (or group of similar items)
 */
export function buildRecipeTree(
  ctx: any,
  itemName: string,
  targetCount: number = 1,
  context: BuildContext = {}
): RootNode {
  const mcData = resolveMcData(ctx);
  
  // Always find all similar items (wood families, etc.)
  // This allows exploring all recipe variants for tie-breaking
  let itemGroup: string[];
  if (mcData) {
    itemGroup = findSimilarItems(mcData, itemName);
  } else {
    itemGroup = [itemName];
  }
  
  // Build for the group
  // When combining is enabled, recipes are grouped and shown with variants
  // When combining is disabled, each recipe becomes a separate branch
  return buildRecipeTreeInternal(ctx, itemGroup, targetCount, context);
}

/**
 * Internal function that builds a recipe tree for a group of similar items
 */
function buildRecipeTreeInternal(
  ctx: any,
  itemGroup: string[],
  targetCount: number,
  context: BuildContext
): RootNode {
  const mcData = resolveMcData(ctx);
  
  // If familyPrefix is set (combining OFF), filter itemGroup to matching family
  let filteredItemGroup = itemGroup;
  if (context.familyPrefix && !context.combineSimilarNodes && itemGroup.length > 1) {
    filteredItemGroup = itemGroup.filter(name => name.startsWith(context.familyPrefix!));
    if (filteredItemGroup.length === 0) {
      filteredItemGroup = [itemGroup[0]]; // Fallback if no match
    }
  }
  
  const primaryItem = filteredItemGroup[0];
  const item = mcData?.itemsByName[primaryItem];

  const invObj = context && context.inventory && typeof context.inventory === 'object' ? context.inventory : null;
  const invMap = makeSupplyFromInventory(invObj);

  // Deduct from inventory if available (check all items in group)
  if (invMap && invMap.size > 0 && targetCount > 0) {
    for (const name of filteredItemGroup) {
      const have = invMap.get(name) || 0;
      if (have > 0) {
        const use = Math.min(have, targetCount);
        invMap.set(name, have - use);
        targetCount -= use;
        if (targetCount <= 0) break;
      }
    }
  }

  const root: RootNode = {
    action: 'root',
    operator: 'OR',
    what: primaryItem,
    count: targetCount,
    children: []
  };

  if (!mcData || !item) return root;
  if (targetCount <= 0) return root;

  const avoidTool = context.avoidTool;
  const visited = context.visited instanceof Set ? context.visited : new Set<string>();
  const preferMinimalTools = context.preferMinimalTools !== false;

  // Check if any item in the group has been visited
  const anyVisited = filteredItemGroup.some(name => visited.has(name));
  if (anyVisited) return root;

  const nextVisited = new Set(visited);
  for (const name of filteredItemGroup) {
    nextVisited.add(name);
  }

  // Collect all recipes for all items in the group
  // Don't dedupe yet - we want to group across variants first
  const allRecipes: Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}> = [];
  for (const name of filteredItemGroup) {
    const itemData = mcData.itemsByName[name];
    if (itemData) {
      // Get raw recipes without deduplication
      const rawRecipes = mcData.recipes[itemData.id] || [];
      for (const recipe of rawRecipes) {
        allRecipes.push({recipe, itemName: name, itemId: itemData.id});
      }
    }
  }

  // Group recipes by canonical shape (same structure across different wood types)
  // When combining is disabled, each recipe becomes its own group (separate branches)
  const recipeGroups = new Map<string, Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}>>();
  for (const entry of allRecipes) {
    let key: string;
    if (context.combineSimilarNodes) {
      // Group similar recipes together (e.g., all wood planks recipes)
      key = getRecipeCanonicalKey(entry.recipe);
    } else {
      // Each recipe gets its own unique key based on ingredients (separate branches)
      // Include ingredient IDs to differentiate oak_planks from spruce_planks
      const ingredientCounts = getIngredientCounts(entry.recipe);
      const ingredientKey = Array.from(ingredientCounts.keys()).sort().join(',');
      key = getRecipeCanonicalKey(entry.recipe) + ':' + entry.itemName + ':' + ingredientKey;
    }
    
    if (!recipeGroups.has(key)) {
      recipeGroups.set(key, []);
    }
    recipeGroups.get(key)!.push(entry);
  }

  const worldBudget = (context && context.worldBudget && typeof context.worldBudget === 'object') ? context.worldBudget : undefined;
  const wb = createWorldBudgetAccessors(worldBudget);

  // Process crafting recipe groups (each group represents recipes with same shape across variants)
  for (const [_canonicalKey, recipeGroup] of recipeGroups.entries()) {
    // Use first recipe as representative
    const recipe = recipeGroup[0].recipe;
    const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
    const ingredientCounts = getIngredientCounts(recipe);

    // Create craft node with the recipe's ingredients
    const craftNode: CraftNode = {
      action: 'craft',
      operator: 'AND',
      what: requiresCraftingTable(recipe) ? 'table' : 'inventory',
      count: craftingsNeeded,
      result: {
        item: recipeGroup[0].itemName,
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
    
    // Add variant information if we have multiple recipes
    if (recipeGroup.length > 1 && context.combineSimilarNodes) {
      craftNode.resultVariants = recipeGroup.map(entry => entry.itemName);
      craftNode.ingredientVariants = recipeGroup.map(entry => {
        const counts = getIngredientCounts(entry.recipe);
        return Array.from(counts.entries())
          .sort(([a], [b]) => a - b)
          .map(([id, _count]) => mcData.items[id]?.name);
      });
      craftNode.variantMode = 'one_of';
    }

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
        if (context.combineSimilarNodes) {
          // When combining is ON, expand to similar items (e.g., all planks)
          const ingredientTree = buildRecipeTree(mcData, ingNameAlloc, neededAfterInv, {
            ...context,
            visited: nextVisited,
            preferMinimalTools,
            inventory: mapToInventoryObject(recipeInv),
            worldBudget
          });
          craftNode.children.push(ingredientTree);
        } else {
          // When combining is OFF, use ONLY the specific ingredient (no expansion)
          // This ensures each branch is internally consistent
          const ingredientTree = buildRecipeTreeInternal(mcData, [ingNameAlloc], neededAfterInv, {
            ...context,
            visited: nextVisited,
            preferMinimalTools,
            inventory: mapToInventoryObject(recipeInv),
            worldBudget
          });
          craftNode.children.push(ingredientTree);
        }
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
  }

  // Process smelting recipes (only for primary item, not all variants)
  const smeltInputs = findFurnaceSmeltsForItem(mcData, primaryItem);
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
      what: primaryItem,
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
          result: { item: primaryItem, perSmelt: perSmelt },
          fuel: fuelName || null,
          children
        };
        return smeltNode;
      })
    };

    root.children.push(smeltGroup);
  }

  // Process mining paths
  let miningPaths: BlockSource[];
  if (filteredItemGroup.length > 1 && context.combineSimilarNodes) {
    // When combining is enabled, collect mining paths for all items in the group
    const allMiningPaths: Array<{path: BlockSource, itemName: string}> = [];
    for (const name of filteredItemGroup) {
      const paths = findBlocksThatDrop(mcData, name);
      for (const path of paths) {
        allMiningPaths.push({path, itemName: name});
      }
    }
    
    // Group all mining paths together (don't split by suffix)
    // This creates ONE mine path entry with all block and target variants
    const allBlocks = Array.from(new Set(allMiningPaths.map(p => p.path.block)));
    const allTargets = Array.from(new Set(allMiningPaths.map(p => p.itemName)));
    const firstPath = allMiningPaths[0].path;
    
    miningPaths = [{
      ...firstPath,
      _blockVariants: allBlocks, // All block types
      _targetVariants: allTargets // All target items
    } as any];
  } else {
    // When combining is disabled, use only paths for the primary item
    // This ensures each branch is internally consistent
    miningPaths = findBlocksThatDrop(mcData, primaryItem);
  }
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
      what: primaryItem,
      count: targetCount,
      children: miningPaths.flatMap(s => {
        if (!s.tool || s.tool === 'any') {
          if (!wb.can('blocks', s.block, targetCount)) return [];
          const leafNode: MineLeafNode = {
            action: 'mine',
            what: s.block,
            targetItem: primaryItem,
            count: targetCount,
            children: []
          };
          
          // Add variant information if available
          if ((s as any)._blockVariants && context.combineSimilarNodes) {
            const blockVariants = (s as any)._blockVariants;
            const targetVariants = (s as any)._targetVariants || [primaryItem];
            if (blockVariants.length > 1) {
              leafNode.whatVariants = blockVariants; // All block types
              leafNode.targetItemVariants = targetVariants; // The items they drop
              leafNode.variantMode = 'one_of';
            }
          }
          
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
            targetItem: primaryItem,
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
            targetItem: primaryItem,
            tool: toolName,
            count: targetCount,
            children: []
          };
          
          // Add variant information if available
          if ((s as any)._blockVariants && context.combineSimilarNodes) {
            const blockVariants = (s as any)._blockVariants;
            const targetVariants = (s as any)._targetVariants || [primaryItem];
            if (blockVariants.length > 1) {
              mineLeaf.whatVariants = blockVariants; // All block types
              mineLeaf.targetItemVariants = targetVariants; // The items they drop
              mineLeaf.variantMode = 'one_of';
            }
          }
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

  // Process hunting paths (only for primary item, not all variants)
  const huntingPaths = findMobsThatDrop(mcData, primaryItem);
  if (huntingPaths.length > 0) {
    const huntGroup: HuntGroupNode = {
      action: 'hunt',
      operator: 'OR',
      what: primaryItem,
      count: targetCount,
      children: huntingPaths.map(s => {
        const p = s.dropChance && s.dropChance > 0 ? s.dropChance : 1;
        const expectedKills = Math.ceil(targetCount / p);

        if (!wb.can('entities', s.mob, expectedKills)) return null;

        const huntLeaf: HuntLeafNode = {
          action: 'hunt',
          what: s.mob,
          targetItem: primaryItem,
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

  // Filter variants based on world availability if enabled
  if (context && context.combineSimilarNodes && worldBudget) {
    try {
      filterVariantsByWorldAvailability(root, worldBudget);
      // After filtering, fix craft nodes to use available variants as primary
      fixCraftNodePrimaryFields(root, worldBudget);
    } catch (_) {
      // Ignore filtering errors
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
      
      // Collect all children from all variants
      const allChildren: TreeNode[] = [];
      for (const variant of group) {
        if (variant.children) {
          allChildren.push(...variant.children);
        }
      }
      
      // Group children by suffix first (to merge all oak_planks, spruce_planks, etc.)
      const childrenBySuffix = new Map<string, TreeNode[]>();
      for (const child of allChildren) {
        const key = child.action === 'root' 
          ? getSuffixTokenFromName(child.what)
          : `${child.action}:${child.what}`;
        if (!childrenBySuffix.has(key)) {
          childrenBySuffix.set(key, []);
        }
        childrenBySuffix.get(key)!.push(child);
      }
      
      // For each group, merge all the variants' subtrees
      const mergedChildren: TreeNode[] = [];
      for (const [_key, childGroup] of childrenBySuffix.entries()) {
        if (childGroup.length === 1) {
          // Single child - just combine it recursively
          combineSimilarNodesInTree(_mcData, childGroup[0]);
          mergedChildren.push(childGroup[0]);
        } else if (childGroup[0].action === 'root') {
          // Multiple root nodes (e.g., root:oak_planks, root:spruce_planks)
          // Use first as representative but combine all their children
          const mergedRoot: RootNode = { ...childGroup[0] } as RootNode;
          
          // Collect all grandchildren from all root variants
          const allGrandchildren: TreeNode[] = [];
          for (const rootNode of childGroup) {
            if (rootNode.children) {
              allGrandchildren.push(...rootNode.children);
            }
          }
          
          // Apply combining to the grandchildren
          for (const gc of allGrandchildren) {
            combineSimilarNodesInTree(_mcData, gc);
          }
          
          // Group and combine grandchildren (craft nodes, mine groups, etc.)
          mergedRoot.children = groupSimilarCraftNodes(_mcData, allGrandchildren);
          
          mergedChildren.push(mergedRoot);
        } else {
          // Other node types - just use first
          combineSimilarNodesInTree(_mcData, childGroup[0]);
          mergedChildren.push(childGroup[0]);
        }
      }
      
      representative.children = mergedChildren;
      
      combinedNodes.push(representative);
    }
  }

  return [...combinedNodes, ...otherNodes];
}

// Removed mergeChildrenFromVariants and groupMineGroups functions
// Now using simpler approach: first variant's children represent all variants

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

/**
 * Fixes craft node primary fields after filtering to use actually available variants
 * Traverses from leaves up, updating each craft node's primary result/ingredients
 * to match what its children can actually provide
 */
function fixCraftNodePrimaryFields(node: TreeNode, worldBudget: any): void {
  if (!node) return;
  
  // Recurse to children first (bottom-up)
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      fixCraftNodePrimaryFields(child, worldBudget);
    }
  }
  
  // Fix craft nodes
  if (node.action === 'craft') {
    const craftNode = node as CraftNode;
    
    // If this craft node has variants and children, update primary fields
    // to match what the children can actually provide
    if (craftNode.resultVariants && craftNode.ingredientVariants && 
        craftNode.children && craftNode.children.length > 0) {
      
      // Find which variant's ingredients are actually available from children
      for (let i = 0; i < craftNode.ingredientVariants.length; i++) {
        const ingredients = craftNode.ingredientVariants[i];
        let allAvailable = true;
        
        // Check if all ingredients for this variant can be provided by children
        for (const ingName of ingredients) {
          let found = false;
          for (const child of craftNode.children) {
            if (child.action === 'root') {
              const rootNode = child as RootNode;
              // Check if this root can provide this ingredient
              // Match on suffix since variants are combined
              const ingSuffix = getSuffixTokenFromName(ingName);
              const rootSuffix = getSuffixTokenFromName(rootNode.what);
              if (ingSuffix === rootSuffix && rootNode.children && rootNode.children.length > 0) {
                found = true;
                break;
              }
            }
          }
          if (!found) {
            allAvailable = false;
            break;
          }
        }
        
        // If this variant's ingredients are available, use it as primary
        if (allAvailable) {
          craftNode.result.item = craftNode.resultVariants[i];
          craftNode.ingredients = ingredients.map((name, idx) => ({
            item: name,
            perCraftCount: craftNode.ingredients[idx]?.perCraftCount || 1
          }));
          break; // Use first available variant
        }
      }
    }
  }
}

/**
 * Filters variant arrays based on world availability
 * Removes variants that aren't available and prunes nodes with no valid variants
 */
function filterVariantsByWorldAvailability(node: TreeNode, worldBudget: any): boolean {
  if (!node) return false;
  
  const wb = createWorldBudgetAccessors(worldBudget);
  
  // Filter craft nodes
  // NOTE: Craft node variant filtering is complex when combined with node combining,
  // because combining merges different variants (oak_planks, spruce_planks) into one node.
  // For now, we rely on path validation to filter out invalid craft combinations.
  // The mine leaf filtering below will ensure only available blocks remain.
  
  // Filter mine leaf nodes
  if (node.action === 'mine' && (!('operator' in node) || !node.operator)) {
    const mineLeaf = node as MineLeafNode;
    
    if (mineLeaf.whatVariants && mineLeaf.whatVariants.length > 1) {
      // Filter variants based on block availability
      const validIndices: number[] = [];
      
      for (let i = 0; i < mineLeaf.whatVariants.length; i++) {
        const blockName = mineLeaf.whatVariants[i];
        // Check if this block type is available in the world
        const available = wb.sum('blocks', [blockName]);
        if (available > 0) {
          validIndices.push(i);
        }
      }
      
      if (validIndices.length === 0) {
        return true; // Node should be removed
      }
      
      if (validIndices.length < mineLeaf.whatVariants.length) {
        // Update the primary block to the first valid variant
        mineLeaf.what = mineLeaf.whatVariants[validIndices[0]];
        if (mineLeaf.targetItemVariants && mineLeaf.targetItemVariants[validIndices[0]]) {
          mineLeaf.targetItem = mineLeaf.targetItemVariants[validIndices[0]];
        }
        
        // If only 1 variant remains, clear the variant fields (no choice to make)
        if (validIndices.length === 1) {
          delete mineLeaf.whatVariants;
          delete mineLeaf.targetItemVariants;
          delete mineLeaf.variantMode;
        } else {
          // Filter the variants to only valid ones
          mineLeaf.whatVariants = validIndices.map(i => mineLeaf.whatVariants![i]);
          if (mineLeaf.targetItemVariants) {
            mineLeaf.targetItemVariants = validIndices.map(i => mineLeaf.targetItemVariants![i]);
          }
        }
      }
    }
  }
  
  // Recurse and filter children
  if (node.children && node.children.length > 0) {
    const filteredChildren: TreeNode[] = [];
    
    for (const child of node.children) {
      const shouldRemove = filterVariantsByWorldAvailability(child, worldBudget);
      if (!shouldRemove) {
        filteredChildren.push(child);
      }
    }
    
    node.children = filteredChildren;
    
    // If this node has no children left, it should be removed
    if (node.children.length === 0) {
      // Remove mine/hunt/smelt/root group nodes with no children
      // Craft nodes with no children are leaf crafts (from inventory), so keep them
      if (node.action === 'mine' || node.action === 'hunt' || node.action === 'smelt' || node.action === 'root') {
        return true;
      }
    }
  }
  
  return false;
}

