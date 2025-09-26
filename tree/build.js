const { getFurnaceInputsFor, chooseMinimalFuelName, getSmeltsPerUnitForFuel } = require('../utils/smeltingConfig');
const { chooseMinimalToolName, getSuffixTokenFromName } = require('../utils/items');
const { extractSpeciesPrefix, baseHasMultipleWoodSpecies } = require('../utils/wood');
const { renderName } = require('../utils/render');
const { makeSupplyFromInventory, mapToInventoryObject } = require('../utils/inventory');
const minecraftData = require('minecraft-data');

function resolveMcData(ctx) {
    if (!ctx) return undefined;
    if (typeof ctx === 'string') return minecraftData(ctx);
    if (ctx.itemsByName && ctx.items && ctx.blocks && ctx.recipes) return ctx;
    if (typeof ctx === 'object' && ctx.version) return minecraftData(ctx.version);
    return undefined;
}

function requiresCraftingTable(recipe) {
    if (recipe.ingredients) return false;
    if (recipe.inShape) {
        const tooWide = recipe.inShape.some(row => row.length > 2);
        const tooTall = recipe.inShape.length > 2;
        return tooWide || tooTall;
    }
    return false;
}

function getItemName(mcData, id) { return mcData.items[id]?.name || String(id); }

function canonicalizeShapedRecipe(mcData, recipe) {
    const rows = recipe.inShape || [];
    const canonRows = rows.map(row => row.map(cell => { if (!cell) return 0; const name = getItemName(mcData, cell); return getSuffixTokenFromName(name); }));
    return JSON.stringify(canonRows);
}

function canonicalizeShapelessRecipe(mcData, recipe) {
    const ids = (recipe.ingredients || []).filter(Boolean);
    const canon = ids.map(id => getSuffixTokenFromName(getItemName(mcData, id))).sort();
    return JSON.stringify(canon);
}

function dedupeRecipesForItem(mcData, itemId, preferFamilies = true) {
    const all = (mcData.recipes[itemId] || []);
    if (!preferFamilies) return all.slice();
    const shapedMap = new Map();
    const shapelessMap = new Map();
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

function findFurnaceSmeltsForItem(mcData, itemName) {
    const inputs = getFurnaceInputsFor(itemName);
    return inputs.filter(n => !!mcData.itemsByName[n]);
}

function findBlocksThatDrop(mcData, itemName) {
    const sources = [];
    const item = mcData.itemsByName[itemName];
    if (!item) return sources;
    Object.values(mcData.blocks).forEach(block => {
        if (block.drops && block.drops.includes(item.id)) {
            sources.push({
                block: block.name,
                tool: block.harvestTools ? Object.keys(block.harvestTools).map(id => mcData.items[id]?.name || id).join('/') : 'any'
            });
        }
    });
    return sources;
}

function findMobsThatDrop(mcData, itemName) {
    const sources = [];
    const item = mcData.itemsByName[itemName];
    if (!item) return sources;
    Object.entries(mcData.entityLoot || {}).forEach(([entityId, lootTable]) => {
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

function getIngredientCounts(recipe) {
    const ingredients = recipe.ingredients || recipe.inShape?.flat().filter(Boolean);
    if (!ingredients) return new Map();
    const ingredientCounts = new Map();
    [...ingredients].sort((a, b) => a - b).forEach(id => { ingredientCounts.set(id, (ingredientCounts.get(id) || 0) + 1); });
    return ingredientCounts;
}

function hasCircularDependency(mcData, itemId, ingredientId) {
    const ingredientRecipes = mcData.recipes[ingredientId] || [];
    return ingredientRecipes.some(r => (r.ingredients && r.ingredients.includes(itemId)) || (r.inShape && r.inShape.some(row => row.includes(itemId))));
}

function buildRecipeTree(ctx, itemName, targetCount = 1, context = {}) {
    const mcData = resolveMcData(ctx);
    const item = mcData?.itemsByName[itemName];
    const invObj = context && context.inventory && typeof context.inventory === 'object' ? context.inventory : null;
    const invMap = makeSupplyFromInventory(invObj);
    if (invMap && invMap.size > 0 && targetCount > 0) {
        const have = invMap.get(itemName) || 0;
        if (have > 0) { const use = Math.min(have, targetCount); invMap.set(itemName, have - use); targetCount -= use; }
    }
    const root = { action: 'root', operator: 'OR', what: itemName, count: targetCount, children: [] };
    if (!mcData || !item) return root;
    if (targetCount <= 0) return root;
    const avoidTool = context.avoidTool;
    const visited = context.visited instanceof Set ? context.visited : new Set();
    const preferMinimalTools = context.preferMinimalTools !== false;
    const familyGenericBases = context.familyGenericBases instanceof Set ? context.familyGenericBases : new Set();
    if (visited.has(itemName)) return root;
    const nextVisited = new Set(visited); nextVisited.add(itemName);
    const preferWoodFamilies = context.preferWoodFamilies !== false;
    let recipes = dedupeRecipesForItem(mcData, item.id, preferWoodFamilies).sort((a, b) => b.result.count - a.result.count);
    recipes.forEach(recipe => {
        const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
        const ingredientCounts = getIngredientCounts(recipe);
        const resultBase = getSuffixTokenFromName(itemName);
        const baseForcedGeneric = familyGenericBases.has(resultBase);
        const resultSpecies = baseForcedGeneric ? null : extractSpeciesPrefix(itemName);
        const craftNode = {
            action: 'craft', operator: 'AND', what: requiresCraftingTable(recipe) ? 'table' : 'inventory', count: craftingsNeeded,
            result: { item: itemName, perCraftCount: recipe.result.count, meta: { generic: baseForcedGeneric || false, selectedSpecies: baseForcedGeneric ? null : (resultSpecies || null) } },
            ingredients: Array.from(ingredientCounts.entries()).sort(([a], [b]) => a - b).map(([id, count]) => {
                const ingName = mcData.items[id]?.name; const base = getSuffixTokenFromName(ingName); const isFamily = baseHasMultipleWoodSpecies(base);
                let selectedSpecies = null; if (resultSpecies && isFamily) { const candidate = `${resultSpecies}_${base}`; if (mcData.itemsByName[candidate]) selectedSpecies = resultSpecies; }
                return { item: ingName, perCraftCount: count, meta: { generic: (isFamily && !selectedSpecies && preferWoodFamilies) || familyGenericBases.has(base), selectedSpecies } };
            }),
            children: []
        };
        const recipeInv = new Map(invMap);
        Array.from(ingredientCounts.entries()).sort(([a], [b]) => a - b).forEach(([ingredientId, count]) => {
            const ingredientItem = mcData.items[ingredientId]; if (!ingredientItem) return;
            const ingNameAlloc = ingredientItem.name; const totalNeeded = count * craftingsNeeded; let neededAfterInv = totalNeeded;
            if (recipeInv && recipeInv.size > 0 && totalNeeded > 0) { const haveIng = recipeInv.get(ingNameAlloc) || 0; if (haveIng > 0) { const take = Math.min(haveIng, totalNeeded); recipeInv.set(ingNameAlloc, haveIng - take); neededAfterInv -= take; } }
            if (neededAfterInv <= 0) return;
            if (hasCircularDependency(mcData, item.id, ingredientId)) {
                const sources = findBlocksThatDrop(mcData, ingredientItem.name);
                if (sources.length > 0) {
                    const neededCount = neededAfterInv;
                    const miningGroup = {
                        action: 'mine', operator: 'OR', what: ingredientItem.name, count: neededCount, children: sources.flatMap(s => {
                            if (!s.tool || s.tool === 'any') { return [{ action: 'mine', what: s.block, targetItem: ingredientItem.name, count: neededCount, children: [] }]; }
                            let tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);
                            // Prefer any acceptable tool that is already in inventory; otherwise fall back to minimal tool
                            const existing = tools.filter(t => recipeInv && (recipeInv.get(t) || 0) > 0);
                            if (existing.length > 0) {
                                const chosen = (preferMinimalTools && existing.length > 1) ? chooseMinimalToolName(existing) : existing[0];
                                return [{ action: 'mine', what: s.block, targetItem: ingredientItem.name, tool: chosen, count: neededCount, children: [] }];
                            }
                            if (preferMinimalTools && tools.length > 1) tools = [chooseMinimalToolName(tools)];
                            return tools.map(toolName => ({ action: 'require', operator: 'AND', what: `tool:${toolName}`, count: 1, children: [buildRecipeTree(mcData, toolName, 1, { avoidTool: toolName, visited: nextVisited, preferMinimalTools, preferWoodFamilies, inventory: mapToInventoryObject(recipeInv) }), { action: 'mine', what: s.block, targetItem: ingredientItem.name, tool: toolName, count: neededCount, children: [] }] }));
                        })
                    };
                    craftNode.children.push(miningGroup);
                }
            } else {
                const ingName = ingredientItem.name; const base = getSuffixTokenFromName(ingName); const isFamily = baseHasMultipleWoodSpecies(base);
                let selectedSpecies = null; if (resultSpecies && isFamily) { const candidate = `${resultSpecies}_${base}`; if (mcData.itemsByName[candidate]) selectedSpecies = resultSpecies; }
                const nextFamilyGenerics = new Set(familyGenericBases); if (isFamily && !selectedSpecies && preferWoodFamilies) nextFamilyGenerics.add(base);
                const ingredientTree = buildRecipeTree(mcData, ingName, neededAfterInv, { ...context, visited: nextVisited, preferMinimalTools, preferWoodFamilies, familyGenericBases: nextFamilyGenerics, inventory: mapToInventoryObject(recipeInv) });
                craftNode.children.push(ingredientTree);
            }
        });

        if (craftNode.what === 'table') {
            const alreadyHaveTable = invMap && (invMap.get('crafting_table') || 0) > 0;
            if (alreadyHaveTable) { root.children.push(craftNode); }
            else {
                const requireTable = { action: 'require', operator: 'AND', what: 'crafting_table', count: 1, children: [buildRecipeTree(mcData, 'crafting_table', 1, { ...context, visited: nextVisited, inventory: mapToInventoryObject(invMap) }), craftNode] };
                root.children.push(requireTable);
            }
        } else { root.children.push(craftNode); }
    });

    const smeltInputs = findFurnaceSmeltsForItem(mcData, itemName);
    if (smeltInputs.length > 0) {
        const perSmelt = 1; const smeltsNeeded = Math.ceil(targetCount / perSmelt);
        const fuelName = chooseMinimalFuelName(mcData); const smeltsPerFuel = fuelName ? getSmeltsPerUnitForFuel(fuelName) : 0; let fuelTotal = fuelName && smeltsPerFuel > 0 ? Math.ceil(smeltsNeeded / smeltsPerFuel) : 0;
        if (fuelName && invMap && invMap.size > 0 && fuelTotal > 0) { const haveFuel = invMap.get(fuelName) || 0; if (haveFuel > 0) fuelTotal = Math.max(0, fuelTotal - haveFuel); }
        const smeltGroup = {
            action: 'smelt', operator: 'OR', what: itemName, count: targetCount, children: smeltInputs.map(inp => {
                let inputNeeded = smeltsNeeded; if (invMap && invMap.size > 0 && inputNeeded > 0) { const haveInp = invMap.get(inp) || 0; if (haveInp > 0) inputNeeded = Math.max(0, inputNeeded - haveInp); }
                const children = [];
                if (!(invMap && (invMap.get('furnace') || 0) > 0)) { children.push({ action: 'require', operator: 'AND', what: 'furnace', count: 1, children: [buildRecipeTree(mcData, 'furnace', 1, { ...context, visited: nextVisited, inventory: mapToInventoryObject(invMap) })] }); }
                if (fuelName && fuelTotal > 0) { children.push(buildRecipeTree(mcData, fuelName, fuelTotal, { ...context, visited: nextVisited, inventory: mapToInventoryObject(invMap) })); }
                if (inputNeeded > 0) { children.push(buildRecipeTree(mcData, inp, inputNeeded, { ...context, visited: nextVisited, inventory: mapToInventoryObject(invMap) })); }
                return { action: 'smelt', operator: 'AND', what: 'furnace', count: smeltsNeeded, input: { item: inp, perSmelt: 1 }, result: { item: itemName, perSmelt: perSmelt }, fuel: fuelName || null, children };
            })
        };
        root.children.push(smeltGroup);
    }

    const miningPaths = findBlocksThatDrop(mcData, itemName);
    if (miningPaths.length > 0) {
        const mineGroup = {
            action: 'mine', operator: 'OR', what: itemName, count: targetCount, children: miningPaths.flatMap(s => {
                if (!s.tool || s.tool === 'any') { return [{ action: 'mine', what: s.block, targetItem: itemName, count: targetCount, children: [] }]; }
                let tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);
                // Prefer any acceptable tool already present in inventory
                const existing = tools.filter(t => invMap && (invMap.get(t) || 0) > 0);
                if (existing.length > 0) {
                    const chosen = (preferMinimalTools && existing.length > 1) ? chooseMinimalToolName(existing) : existing[0];
                    return [{ action: 'mine', what: s.block, targetItem: itemName, tool: chosen, count: targetCount, children: [] }];
                }
                if (preferMinimalTools && tools.length > 1) tools = [chooseMinimalToolName(tools)];
                return tools.map(toolName => ({ action: 'require', operator: 'AND', what: `tool:${toolName}`, count: 1, children: [buildRecipeTree(mcData, toolName, 1, { ...context, avoidTool: toolName, visited: nextVisited, preferMinimalTools, preferWoodFamilies, familyGenericBases, inventory: mapToInventoryObject(invMap) }), { action: 'mine', what: s.block, targetItem: itemName, tool: toolName, count: targetCount, children: [] }] }));
            })
        };
        root.children.push(mineGroup);
    }

    const huntingPaths = findMobsThatDrop(mcData, itemName);
    if (huntingPaths.length > 0) {
        const huntGroup = {
            action: 'hunt',
            operator: 'OR',
            what: itemName,
            count: targetCount,
            children: huntingPaths.map(s => {
                const p = s.dropChance && s.dropChance > 0 ? s.dropChance : 1;
                const expectedKills = Math.ceil(targetCount / p);
                return { action: 'hunt', what: s.mob, targetItem: itemName, count: expectedKills, dropChance: s.dropChance, children: [] };
            })
        };
        root.children.push(huntGroup);
    }

    return root;
}

module.exports = {
    buildRecipeTree,
    resolveMcData,
    requiresCraftingTable,
    dedupeRecipesForItem,
    getIngredientCounts,
    hasCircularDependency,
    findBlocksThatDrop,
    findFurnaceSmeltsForItem,
    findMobsThatDrop
};


