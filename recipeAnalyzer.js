const minecraftData = require('minecraft-data')
const { getFurnaceInputsFor, chooseMinimalFuelName, getSmeltsPerUnitForFuel } = require('./smeltingConfig')
let lastMcData = null
let woodSpeciesTokens = null
let currentSpeciesContext = null
let targetItemNameGlobal = null

function resolveMcData(ctx) {
    if (!ctx) return undefined;
    if (typeof ctx === 'string') return minecraftData(ctx);
    if (ctx.itemsByName && ctx.items && ctx.blocks && ctx.recipes) return ctx;
    if (typeof ctx === 'object' && ctx.version) return minecraftData(ctx.version);
    return undefined;
}

function chooseMinimalToolName(toolNames) {
    if (!toolNames || toolNames.length === 0) return undefined;
    const tierRank = {
        wooden: 0,
        golden: 0.5,
        stone: 1,
        iron: 2,
        diamond: 3,
        netherite: 4
    };
    function rank(name) {
        // expected pattern like wooden_pickaxe, iron_axe, shears, etc.
        const first = String(name).split('_')[0];
        const base = tierRank[first];
        if (base === undefined) return 10; // unknown tools ranked higher
        return base;
    }
    let best = toolNames[0];
    let bestRank = rank(best);
    for (let i = 1; i < toolNames.length; i++) {
        const r = rank(toolNames[i]);
        if (r < bestRank) { best = toolNames[i]; bestRank = r; }
    }
    return best;
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

function getItemName(mcData, id) {
    return mcData.items[id]?.name || String(id);
}

function getSuffixTokenFromName(name) {
    if (!name) return name;
    const idx = name.lastIndexOf('_');
    if (idx === -1) return name; // no underscore
    return name.slice(idx + 1); // take final token as base (e.g., planks, log, wood, table)
}

function extractSpeciesPrefix(name) {
    if (!name || !name.includes('_') || !woodSpeciesTokens) return null;
    const idx = name.lastIndexOf('_');
    if (idx <= 0) return null;
    const prefix = name.slice(0, idx);
    // Some species tokens include underscores themselves (e.g., dark_oak)
    // Check all tokens to find the longest match at the start
    let best = null;
    for (const s of woodSpeciesTokens) {
        if (prefix === s) { best = s; break; }
        // Handle names like bamboo_block etc. Only exact prefix match counts.
    }
    return best;
}

function baseHasMultipleWoodSpecies(baseName) {
    if (!lastMcData || !woodSpeciesTokens || !baseName) return false;
    let count = 0;
    for (const species of woodSpeciesTokens) {
        const candidate = `${species}_${baseName}`;
        if (lastMcData.itemsByName[candidate]) {
            count++;
            if (count >= 2) return true;
        }
    }
    return false;
}

function renderName(name, meta) {
    if (!name) return name;
    // Always keep exact target name concrete
    if (targetItemNameGlobal && name === targetItemNameGlobal) return name;
    if (meta && meta.selectedSpecies) {
        const base = getSuffixTokenFromName(name);
        const forced = `${meta.selectedSpecies}_${base}`;
        if (lastMcData?.itemsByName?.[forced]) return forced;
        return name;
    }
    if (meta && meta.generic) {
        const base = getSuffixTokenFromName(name);
        return `generic_${base}`;
    }
    return genericizeItemName(name);
}

function genericizeItemName(name) {
    if (!lastMcData) return name;
    if (targetItemNameGlobal && name === targetItemNameGlobal) return name;
    if (!name || !name.includes('_')) return name;
    // Build wood species tokens once (e.g., oak, spruce, birch, dark_oak, crimson, warped, mangrove, cherry, bamboo)
    if (!woodSpeciesTokens) {
        woodSpeciesTokens = new Set();
        const names = Object.keys(lastMcData.itemsByName || {});
        for (const n of names) {
            if (n.endsWith('_planks')) {
                const species = n.slice(0, -('_planks'.length));
                if (species.length > 0) woodSpeciesTokens.add(species);
            }
        }
    }
    // If we are in a species-specific context (e.g., cherry_stairs), do not genericize wood items for that species
    if (currentSpeciesContext && name.startsWith(currentSpeciesContext + '_')) return name;
    const base = getSuffixTokenFromName(name); // e.g., planks, log, wood, slab, stairs
    // Count how many species-specific items exist for this base
    let count = 0;
    for (const species of woodSpeciesTokens) {
        const candidate = `${species}_${base}`;
        if (lastMcData.itemsByName[candidate]) count++;
        if (count >= 2) break;
    }
    if (count >= 2) return `generic_${base}`; // family with multiple wood species variants
    return name;
}

function canonicalizeShapedRecipe(mcData, recipe) {
    // Returns a signature string that ignores species by replacing item names with their suffix tokens
    // and preserves the exact shape (rows/cols and empties)
    const rows = recipe.inShape || [];
    const canonRows = rows.map(row => row.map(cell => {
        if (!cell) return 0;
        const name = getItemName(mcData, cell);
        return getSuffixTokenFromName(name);
    }));
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
            // Unknown type; keep as-is by creating a unique key per object identity
            shapelessMap.set(Math.random() + '', r);
        }
    }
    return [...shapedMap.values(), ...shapelessMap.values()];
}

// Smelting helpers via config
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
                tool: block.harvestTools ?
                    Object.keys(block.harvestTools).map(id => mcData.items[id]?.name || id).join('/') :
                    'any'
            });
        }
    });

    return sources;
}

function printMiningPath(sources, depth, targetCount) {
    if (sources.length === 0) return;

    console.log(`${' '.repeat((depth + 1) * 2)}├─ mine (${targetCount}x)`);
    sources.forEach((source, index) => {
        const isLast = index === sources.length - 1;
        const toolInfo = source.tool === 'any' ? '' : ` (needs ${source.tool})`;
        console.log(`${' '.repeat((depth + 2) * 2)}${isLast ? '└─' : '├─'} ${source.block}${toolInfo}`);
    });
}

function getIngredientCounts(recipe) {
    const ingredients = recipe.ingredients || recipe.inShape?.flat().filter(Boolean);
    if (!ingredients) return new Map();

    const ingredientCounts = new Map();
    [...ingredients].sort((a, b) => a - b).forEach(id => {
        ingredientCounts.set(id, (ingredientCounts.get(id) || 0) + 1);
    });
    return ingredientCounts;
}

function hasCircularDependency(mcData, itemId, ingredientId) {
    const ingredientRecipes = mcData.recipes[ingredientId] || [];
    return ingredientRecipes.some(r =>
        (r.ingredients && r.ingredients.includes(itemId)) ||
        (r.inShape && r.inShape.some(row => row.includes(itemId)))
    );
}

function printRecipeConversion(mcData, ingredientCounts, recipe, itemName, depth) {
    const ingredientList = Array.from(ingredientCounts.entries())
        .sort(([idA], [idB]) => idA - idB)
        .map(([id, count]) => `${count} ${mcData.items[id].name}`)
        .join(' + ');
    console.log(`${' '.repeat((depth + 2) * 2)}├─ ${ingredientList} to ${recipe.result.count} ${itemName}`);
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
                    dropChance: lootTable.drops.find(d =>
                        d.item?.toLowerCase().replace(' ', '_') === itemName
                    )?.dropChance
                });
            }
        }
    });

    return sources;
}

function printHuntingPath(sources, depth, targetCount) {
    if (sources.length === 0) return;

    console.log(`${' '.repeat((depth + 1) * 2)}├─ hunt (${targetCount}x)`);
    sources.forEach((source, index) => {
        const isLast = index === sources.length - 1;
        const chanceInfo = source.dropChance ? ` (${source.dropChance * 100}% chance)` : '';
        console.log(`${' '.repeat((depth + 2) * 2)}${isLast ? '└─' : '├─'} ${source.mob}${chanceInfo}`);
    });
}

function buildRecipeTree(ctx, itemName, targetCount = 1, context = {}) {
    const mcData = resolveMcData(ctx);
    const item = mcData?.itemsByName[itemName];
    // Inventory helpers (object <-> map)
    const invObj = context && context.inventory && typeof context.inventory === 'object' ? context.inventory : null;
    function invToMap(obj) {
        const m = new Map();
        if (!obj) return m;
        for (const [k, v] of Object.entries(obj)) {
            const n = Number(v);
            if (!Number.isNaN(n) && n > 0) m.set(k, n);
        }
        return m;
    }
    function mapToInv(m) {
        const o = {};
        if (!m) return o;
        for (const [k, v] of m.entries()) {
            if (v > 0) o[k] = v;
        }
        return o;
    }
    const invMap = invToMap(invObj);
    // Root-level subtraction: if inventory already has some of the target, reduce required count
    if (invMap && invMap.size > 0 && targetCount > 0) {
        const have = invMap.get(itemName) || 0;
        if (have > 0) {
            const use = Math.min(have, targetCount);
            invMap.set(itemName, have - use);
            targetCount -= use;
        }
    }
    const root = { action: 'root', operator: 'OR', what: itemName, count: targetCount, children: [] };

    if (!mcData || !item) return root;
    if (targetCount <= 0) return root;
    const avoidTool = context.avoidTool;
    const visited = context.visited instanceof Set ? context.visited : new Set();
    const preferMinimalTools = context.preferMinimalTools !== false; // default true
    const familyGenericBases = context.familyGenericBases instanceof Set ? context.familyGenericBases : new Set();
    if (visited.has(itemName)) return root;
    const nextVisited = new Set(visited);
    nextVisited.add(itemName);

    const preferWoodFamilies = context.preferWoodFamilies !== false; // default true
    const recipes = dedupeRecipesForItem(mcData, item.id, preferWoodFamilies)
        .sort((a, b) => b.result.count - a.result.count);
    recipes.forEach(recipe => {
        const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
        const ingredientCounts = getIngredientCounts(recipe);
        const resultBase = getSuffixTokenFromName(itemName);
        const baseForcedGeneric = familyGenericBases.has(resultBase);
        const resultSpecies = baseForcedGeneric ? null : extractSpeciesPrefix(itemName);
        const resultIsFamily = baseHasMultipleWoodSpecies(resultBase);
        const craftNode = {
            action: 'craft',
            operator: 'AND',
            what: requiresCraftingTable(recipe) ? 'table' : 'inventory',
            count: craftingsNeeded,
            result: {
                item: itemName,
                perCraftCount: recipe.result.count,
                meta: {
                    generic: baseForcedGeneric || false,
                    selectedSpecies: baseForcedGeneric ? null : (resultSpecies || null)
                }
            },
            ingredients: Array.from(ingredientCounts.entries())
                .sort(([a], [b]) => a - b)
                .map(([id, count]) => {
                    const ingName = mcData.items[id]?.name;
                    const base = getSuffixTokenFromName(ingName);
                    const isFamily = baseHasMultipleWoodSpecies(base);
                    let selectedSpecies = null;
                    if (resultSpecies && isFamily) {
                        const candidate = `${resultSpecies}_${base}`;
                        if (mcData.itemsByName[candidate]) selectedSpecies = resultSpecies;
                    }
                    return {
                        item: ingName,
                        perCraftCount: count,
                        meta: {
                            generic: (isFamily && !selectedSpecies && preferWoodFamilies) || familyGenericBases.has(base),
                            selectedSpecies: selectedSpecies
                        }
                    };
                }),
            children: []
        };

        // Make an inventory working copy for this specific recipe branch,
        // so we can allocate inventory across its AND children without affecting siblings
        const recipeInv = new Map(invMap);
        Array.from(ingredientCounts.entries())
            .sort(([a], [b]) => a - b)
            .forEach(([ingredientId, count]) => {
                const ingredientItem = mcData.items[ingredientId];
                if (!ingredientItem) return;
                // Allocate inventory to this ingredient first
                const ingNameAlloc = ingredientItem.name;
                const totalNeeded = count * craftingsNeeded;
                let neededAfterInv = totalNeeded;
                if (recipeInv && recipeInv.size > 0 && totalNeeded > 0) {
                    const haveIng = recipeInv.get(ingNameAlloc) || 0;
                    if (haveIng > 0) {
                        const take = Math.min(haveIng, totalNeeded);
                        recipeInv.set(ingNameAlloc, haveIng - take);
                        neededAfterInv -= take;
                    }
                }
                if (neededAfterInv <= 0) return; // fully satisfied by inventory

                if (hasCircularDependency(mcData, item.id, ingredientId)) {
                    const sources = findBlocksThatDrop(mcData, ingredientItem.name);
                    if (sources.length > 0) {
                        const neededCount = neededAfterInv;
                        const miningGroup = {
                            action: 'mine',
                            operator: 'OR',
                            what: ingredientItem.name,
                            count: neededCount,
                            children: sources.flatMap(s => {
                                if (!s.tool || s.tool === 'any') {
                                    return [{ action: 'mine', what: s.block, targetItem: ingredientItem.name, count: neededCount, children: [] }];
                                }
                                let tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);
                                if (preferMinimalTools && tools.length > 1) {
                                    tools = [chooseMinimalToolName(tools)];
                                }
                                return tools.map(toolName => {
                                    const alreadyHaveTool = recipeInv && (recipeInv.get(toolName) || 0) > 0;
                                    if (alreadyHaveTool) {
                                        return { action: 'mine', what: s.block, targetItem: ingredientItem.name, tool: toolName, count: neededCount, children: [] };
                                    }
                                    return {
                                        action: 'require',
                                        operator: 'AND',
                                        what: `tool:${toolName}`,
                                        count: 1,
                                        children: [
                                            buildRecipeTree(mcData, toolName, 1, { avoidTool: toolName, visited: nextVisited, preferMinimalTools, preferWoodFamilies, inventory: mapToInv(recipeInv) }),
                                            { action: 'mine', what: s.block, targetItem: ingredientItem.name, tool: toolName, count: neededCount, children: [] }
                                        ]
                                    };
                                });
                            })
                        };
                        craftNode.children.push(miningGroup);
                    }
                } else {
                    const ingName = ingredientItem.name;
                    const base = getSuffixTokenFromName(ingName);
                    const isFamily = baseHasMultipleWoodSpecies(base);
                    let selectedSpecies = null;
                    if (resultSpecies && isFamily) {
                        const candidate = `${resultSpecies}_${base}`;
                        if (mcData.itemsByName[candidate]) selectedSpecies = resultSpecies;
                    }
                    const nextFamilyGenerics = new Set(familyGenericBases);
                    if (isFamily && !selectedSpecies && preferWoodFamilies) {
                        nextFamilyGenerics.add(base);
                    }
                    const ingredientTree = buildRecipeTree(mcData, ingName, neededAfterInv, { ...context, visited: nextVisited, preferMinimalTools, preferWoodFamilies, familyGenericBases: nextFamilyGenerics, inventory: mapToInv(recipeInv) });
                    craftNode.children.push(ingredientTree);
                }
            });

        if (craftNode.what === 'table') {
            const alreadyHaveTable = invMap && (invMap.get('crafting_table') || 0) > 0;
            if (alreadyHaveTable) {
                // No need to require crafting table; keep craftNode directly
                root.children.push(craftNode);
            } else {
                const requireTable = {
                    action: 'require',
                    operator: 'AND',
                    what: 'crafting_table',
                    count: 1,
                    children: [
                        buildRecipeTree(mcData, 'crafting_table', 1, { ...context, visited: nextVisited, inventory: mapToInv(invMap) }),
                        craftNode
                    ]
                };
                root.children.push(requireTable);
            }
        } else {
            root.children.push(craftNode);
        }
    });

    // Insert smelting (furnace) after crafting but before mining/hunting
    const smeltInputs = findFurnaceSmeltsForItem(mcData, itemName);
    if (smeltInputs.length > 0) {
        const perSmelt = 1; // iron: 1 input -> 1 output
        const smeltsNeeded = Math.ceil(targetCount / perSmelt);
        const fuelName = chooseMinimalFuelName(mcData);
        const smeltsPerFuel = fuelName ? getSmeltsPerUnitForFuel(fuelName) : 0;
        let fuelTotal = fuelName && smeltsPerFuel > 0 ? Math.ceil(smeltsNeeded / smeltsPerFuel) : 0;
        // Subtract inventory fuel
        if (fuelName && invMap && invMap.size > 0 && fuelTotal > 0) {
            const haveFuel = invMap.get(fuelName) || 0;
            if (haveFuel > 0) fuelTotal = Math.max(0, fuelTotal - haveFuel);
        }
        const smeltGroup = {
            action: 'smelt',
            operator: 'OR',
            what: itemName,
            count: targetCount,
            children: smeltInputs.map(inp => {
                // Compute input after inventory
                let inputNeeded = smeltsNeeded;
                if (invMap && invMap.size > 0 && inputNeeded > 0) {
                    const haveInp = invMap.get(inp) || 0;
                    if (haveInp > 0) inputNeeded = Math.max(0, inputNeeded - haveInp);
                }
                const children = [];
                // Skip requiring furnace if inventory already has one
                if (!(invMap && (invMap.get('furnace') || 0) > 0)) {
                    children.push({ action: 'require', operator: 'AND', what: 'furnace', count: 1, children: [buildRecipeTree(mcData, 'furnace', 1, { ...context, visited: nextVisited, inventory: mapToInv(invMap) })] });
                }
                if (fuelName && fuelTotal > 0) {
                    children.push(buildRecipeTree(mcData, fuelName, fuelTotal, { ...context, visited: nextVisited, inventory: mapToInv(invMap) }));
                }
                if (inputNeeded > 0) {
                    children.push(buildRecipeTree(mcData, inp, inputNeeded, { ...context, visited: nextVisited, inventory: mapToInv(invMap) }));
                }
                return {
                    action: 'smelt',
                    operator: 'AND',
                    what: 'furnace',
                    count: smeltsNeeded,
                    input: { item: inp, perSmelt: 1 },
                    result: { item: itemName, perSmelt: perSmelt },
                    fuel: fuelName || null,
                    children
                };
            })
        };
        root.children.push(smeltGroup);
    }

    const miningPaths = findBlocksThatDrop(mcData, itemName);
    if (miningPaths.length > 0) {
        const mineGroup = {
            action: 'mine',
            operator: 'OR',
            what: itemName,
            count: targetCount,
            children: miningPaths.flatMap(s => {
                if (!s.tool || s.tool === 'any') {
                    return [{ action: 'mine', what: s.block, targetItem: itemName, count: targetCount, children: [] }];
                }
                let tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);
                if (preferMinimalTools && tools.length > 1) {
                    tools = [chooseMinimalToolName(tools)];
                }
                return tools.map(toolName => {
                    const alreadyHaveTool = invMap && (invMap.get(toolName) || 0) > 0;
                    if (alreadyHaveTool) {
                        return { action: 'mine', what: s.block, targetItem: itemName, tool: toolName, count: targetCount, children: [] };
                    }
                    return {
                        action: 'require',
                        operator: 'AND',
                        what: `tool:${toolName}`,
                        count: 1,
                        children: [
                            buildRecipeTree(mcData, toolName, 1, { avoidTool: toolName, visited: nextVisited, preferMinimalTools, preferWoodFamilies, familyGenericBases, inventory: mapToInv(invMap) }),
                            { action: 'mine', what: s.block, targetItem: itemName, tool: toolName, count: targetCount, children: [] }
                        ]
                    };
                });
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

function logRecipeTree(tree, depth = 1) {
    if (!tree) return;
    const indent = ' '.repeat(depth * 2);
    if (tree.action === 'root') {
        const op = tree.operator === 'AND' ? 'ALL' : 'ANY';
        console.log(`${indent}├─ ${tree.what} (want ${tree.count}) [${op}]`);
        const children = tree.children || [];
        children.forEach((child, idx) => {
            const isLast = idx === children.length - 1;
            logRecipeNode(child, depth + 1, isLast);
        });
        return;
    }
    logRecipeNode(tree, depth, true);
}

function logRecipeNode(node, depth, isLastAtThisLevel) {
    const indent = ' '.repeat(depth * 2);
    const branch = isLastAtThisLevel ? '└─' : '├─';
    if (node.action === 'craft') {
        const op = node.operator === 'AND' ? 'ALL' : 'ANY';
        console.log(`${indent}${branch} craft in ${node.what} (${node.count}x) [${op}]`);
        if (node.ingredients && node.ingredients.length > 0 && node.result) {
            const ingredientsStr = node.ingredients.map(i => `${i.perCraftCount} ${renderName(i.item, i.meta)}`).join(' + ');
            const resultName = renderName(node.result.item, node.result.meta);
            console.log(`${' '.repeat((depth + 1) * 2)}├─ ${ingredientsStr} to ${node.result.perCraftCount} ${resultName}`);
        }
        const children = node.children || [];
        children.forEach((child, idx) => logRecipeTree(child, depth + 2));
        return;
    }
    if (node.action === 'mine') {
        if (node.children && node.children.length > 0) {
            const op = node.operator === 'AND' ? 'ALL' : 'ANY';
            const targetInfo = node.what ? ` for ${renderName(node.what)}` : '';
            console.log(`${indent}${branch} mine${targetInfo} (${node.count}x) [${op}]`);
            node.children.forEach((child, idx) => {
                if (child.action === 'require') {
                    logRecipeTree(child, depth + 1);
                } else {
                    const subIndent = ' '.repeat((depth + 1) * 2);
                    const subBranch = idx === node.children.length - 1 ? '└─' : '├─';
                    const toolInfo = child.tool && child.tool !== 'any' ? ` (needs ${child.tool})` : '';
                    const childTargetInfo = child.targetItem ? ` for ${renderName(child.targetItem)}` : '';
                    console.log(`${subIndent}${subBranch} ${renderName(child.what)}${childTargetInfo}${toolInfo}`);
                }
            });
        } else {
            const targetInfo = node.targetItem ? ` for ${renderName(node.targetItem)}` : '';
            console.log(`${indent}${branch} ${renderName(node.what)}${targetInfo}`);
        }
        return;
    }
    if (node.action === 'smelt') {
        if (node.children && node.children.length > 0) {
            const op = node.operator === 'AND' ? 'ALL' : 'ANY';
            const fuelInfo = node.fuel ? ` with ${renderName(node.fuel)}` : '';
            console.log(`${indent}${branch} smelt in furnace${fuelInfo} (${node.count}x) [${op}]`);
            if (node.input && node.result) {
                const ingStr = `${node.input.perSmelt} ${renderName(node.input.item)}`;
                const resStr = `${node.result.perSmelt} ${renderName(node.result.item)}`;
                console.log(`${' '.repeat((depth + 1) * 2)}├─ ${ingStr} to ${resStr}`);
            }
            node.children.forEach((child, idx) => logRecipeTree(child, depth + 1));
        } else {
            console.log(`${indent}${branch} smelt ${renderName(node.what)}`);
        }
        return;
    }
    if (node.action === 'require') {
        const op = node.operator === 'AND' ? 'ALL' : 'ANY';
        console.log(`${indent}${branch} require ${node.what.replace('tool:', '')} [${op}]`);
        const children = node.children || [];
        children.forEach((child, idx) => logRecipeTree(child, depth + 1));
        return;
    }
    if (node.action === 'hunt') {
        if (node.children && node.children.length > 0) {
            const op = node.operator === 'AND' ? 'ALL' : 'ANY';
            console.log(`${indent}${branch} hunt (${node.count}x) [${op}]`);
            node.children.forEach((child, idx) => {
                const subIndent = ' '.repeat((depth + 1) * 2);
                const subBranch = idx === node.children.length - 1 ? '└─' : '├─';
                const chance = child.dropChance ? ` (${child.dropChance * 100}% chance)` : '';
                const toolInfo = child.tool && child.tool !== 'any' ? ` (needs ${child.tool})` : '';
                const targetInfo = child.targetItem ? ` for ${renderName(child.targetItem)}` : '';
                console.log(`${subIndent}${subBranch} ${renderName(child.what)}${targetInfo}${chance}${toolInfo}`);
            });
        } else {
            console.log(`${indent}${branch} ${renderName(node.what)}`);
        }
        return;
    }
    if (node.action === 'root') {
        logRecipeTree(node, depth);
    }
}

function analyzeRecipes(ctx, itemName, targetCount = 1, options = {}) {
    lastMcData = resolveMcData(ctx);
    targetItemNameGlobal = itemName;
    // Determine species context from target if it is wood-specific
    if (!woodSpeciesTokens) {
        woodSpeciesTokens = new Set();
        const names = Object.keys(lastMcData.itemsByName || {});
        for (const n of names) {
            if (n.endsWith('_planks')) {
                const species = n.slice(0, -('_planks'.length));
                if (species.length > 0) woodSpeciesTokens.add(species);
            }
        }
    }
    currentSpeciesContext = null;
    for (const species of woodSpeciesTokens) {
        if (itemName.startsWith(species + '_')) { currentSpeciesContext = species; break; }
    }
    const tree = buildRecipeTree(lastMcData, itemName, targetCount, { inventory: options && options.inventory ? options.inventory : undefined });
    if (!options || options.log !== false) logRecipeTree(tree);
    return tree;
}

function enumerateActionPaths(tree) {
    function enumerate(node) {
        if (!node) return [];
        if (node.action === 'root') {
            const results = [];
            const children = node.children || [];
            children.forEach(child => {
                const childPaths = enumerate(child);
                results.push(...childPaths);
            });
            return results;
        }
        if (node.action === 'require') {
            const children = node.children || [];
            if (children.length === 0) return [];
            // AND semantics: concatenate sequences of all children in order
            let combined = [[]];
            for (const child of children) {
                const childPaths = enumerate(child);
                if (childPaths.length === 0) return [];
                const nextCombined = [];
                combined.forEach(prefix => {
                    childPaths.forEach(seq => {
                        nextCombined.push(prefix.concat(seq));
                    });
                });
                combined = nextCombined;
            }
            return combined;
        }
        if (node.action === 'craft') {
            const children = node.children || [];
            if (children.length === 0) {
                return [[{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }]];
            }
            const perChildPaths = children.map(enumerate);
            if (perChildPaths.some(p => p.length === 0)) return [];
            let combined = [[]];
            perChildPaths.forEach(pathSet => {
                const nextCombined = [];
                combined.forEach(prefix => {
                    pathSet.forEach(childPath => {
                        nextCombined.push(prefix.concat(childPath));
                    });
                });
                combined = nextCombined;
            });
            combined = combined.map(seq => seq.concat([{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }]));
            return combined;
        }
        if ((node.action === 'mine' || node.action === 'hunt') && node.operator === 'OR' && node.children && node.children.length > 0) {
            const results = [];
            node.children.forEach(child => {
                const childPaths = enumerate(child);
                results.push(...childPaths);
            });
            return results;
        }
        if (node.action === 'smelt' && node.operator === 'OR' && node.children && node.children.length > 0) {
            const results = [];
            node.children.forEach(child => { results.push(...enumerate(child)); });
            return results;
        }
        if (node.action === 'smelt' && node.operator === 'AND' && node.children && node.children.length > 0) {
            let combined = [[]];
            for (const child of node.children) {
                const childPaths = enumerate(child);
                if (childPaths.length === 0) return [];
                const nextCombined = [];
                combined.forEach(prefix => childPaths.forEach(seq => nextCombined.push(prefix.concat(seq))));
                combined = nextCombined;
            }
            combined = combined.map(seq => seq.concat([{ action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }]));
            return combined;
        }
        if ((node.action === 'mine' || node.action === 'hunt') && (!node.children || node.children.length === 0)) {
            return [[{ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool, targetItem: node.targetItem }]];
        }
        return [];
    }
    return enumerate(tree);
}

function enumerateActionPathsGenerator(tree, options = {}) {
    const invObj = options && options.inventory && typeof options.inventory === 'object' ? options.inventory : null;
    // Treat all tools as persistent (plus table/furnace)
    const persistentNames = (() => {
        const s = new Set(['crafting_table', 'furnace']);
        if (lastMcData) {
            try {
                Object.values(lastMcData.blocks || {}).forEach(b => {
                    if (b && b.harvestTools) {
                        Object.keys(b.harvestTools).forEach(id => {
                            const nm = lastMcData.items[id]?.name || String(id);
                            if (nm) s.add(nm);
                        });
                    }
                });
                const toolSuffixes = new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']);
                Object.keys(lastMcData.itemsByName || {}).forEach(n => {
                    const base = getSuffixTokenFromName(n);
                    if (toolSuffixes.has(base)) s.add(n);
                });
            } catch (_) { /* ignore */ }
        }
        return s;
    })();
    function isPersistentItemName(name) { return !!name && persistentNames.has(name); }
    function persistentSetFromInventory(inv) {
        const have = new Set();
        if (!inv) return have;
        for (const [k, v] of Object.entries(inv)) {
            if ((v || 0) > 0 && isPersistentItemName(k)) have.add(k);
        }
        return have;
    }
    function requiredPersistentFromRequire(node) {
        const what = String(node.what || '');
        if (what.startsWith('tool:')) return what.slice(5);
        if (what === 'crafting_table' || what === 'furnace') return what;
        return null;
    }
    function applyPersistentFromSteps(haveSet, steps) {
        const have = new Set(haveSet);
        for (const st of steps) {
            if (st && st.action === 'craft' && st.result && isPersistentItemName(st.result.item)) have.add(st.result.item);
            if (st && st.action === 'smelt' && st.result && isPersistentItemName(st.result.item)) have.add(st.result.item);
            if (st && st.action === 'mine' && st.what && isPersistentItemName(st.what)) have.add(st.what);
        }
        return have;
    }
    function* enumerate(node, have) {
        if (!node) return;
        if (node.action === 'root') {
            const children = node.children || [];
            for (const child of children) {
                yield* enumerate(child, have);
            }
            return;
        }
        if (node.action === 'require') {
            const children = node.children || [];
            const reqName = requiredPersistentFromRequire(node);
            const startIdx = (reqName && have && have.has(reqName)) ? 1 : 0;
            function* enumerateChildren(idx, accSteps, haveNow) {
                if (idx >= children.length) { yield accSteps; return; }
                for (const seg of enumerate(children[idx], haveNow)) {
                    const haveNext = applyPersistentFromSteps(haveNow, seg);
                    yield* enumerateChildren(idx + 1, accSteps.concat(seg), haveNext);
                }
            }
            yield* enumerateChildren(startIdx, [], have || new Set());
            return;
        }
        if (node.action === 'craft') {
            const children = node.children || [];
            if (children.length === 0) {
                yield [{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }];
                return;
            }
            // If crafting produces a persistent item we already have, skip the entire subtree
            if (node.result && isPersistentItemName(node.result.item) && have && have.has(node.result.item)) {
                yield [];
                return;
            }
            function* enumerateChildren(idx, accSteps, haveNow) {
                if (idx >= children.length) {
                    yield accSteps.concat([{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }]);
                    return;
                }
                for (const seg of enumerate(children[idx], haveNow)) {
                    const haveNext = applyPersistentFromSteps(haveNow, seg);
                    yield* enumerateChildren(idx + 1, accSteps.concat(seg), haveNext);
                }
            }
            yield* enumerateChildren(0, [], have || new Set());
            return;
        }
        if (node.action === 'smelt') {
            if (node.operator === 'OR' && node.children && node.children.length > 0) {
                for (const child of node.children) yield* enumerate(child, have);
                return;
            }
            if (node.operator === 'AND' && node.children && node.children.length > 0) {
                function* enumerateChildren(idx, accSteps, haveNow) {
                    if (idx >= node.children.length) {
                        yield accSteps.concat([{ action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }]);
                        return;
                    }
                    // If this child is a require furnace and we already have it, skip it
                    const child = node.children[idx];
                    const childReqName = child && child.action === 'require' ? requiredPersistentFromRequire(child) : null;
                    const skip = childReqName && haveNow && haveNow.has(childReqName);
                    if (skip) {
                        yield* enumerateChildren(idx + 1, accSteps, haveNow);
                        return;
                    }
                    for (const seg of enumerate(child, haveNow)) {
                        const haveNext = applyPersistentFromSteps(haveNow, seg);
                        yield* enumerateChildren(idx + 1, accSteps.concat(seg), haveNext);
                    }
                }
                yield* enumerateChildren(0, [], have || new Set());
                return;
            }
            if (node.operator === 'AND' && (!node.children || node.children.length === 0)) {
                // All prerequisites satisfied by inventory; perform the smelt step itself
                yield [{ action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }];
                return;
            }
        }
        if ((node.action === 'mine' || node.action === 'hunt') && node.operator === 'OR' && node.children && node.children.length > 0) {
            for (const child of node.children) {
                yield* enumerate(child, have);
            }
            return;
        }
        if ((node.action === 'mine' || node.action === 'hunt') && (!node.children || node.children.length === 0)) {
            yield [{ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool, targetItem: node.targetItem }];
            return;
        }
    }
    return enumerate(tree, persistentSetFromInventory(invObj));
}

function computeTreeMaxDepth(node) {
    if (!node) return 0;
    if (!node.children || node.children.length === 0) return 1;
    let maxChild = 0;
    for (const child of node.children) {
        const d = computeTreeMaxDepth(child);
        if (d > maxChild) maxChild = d;
    }
    return 1 + maxChild;
}

function countActionPaths(node) {
    if (!node) return 0;
    if (!node.children || node.children.length === 0) {
        // Leaf action contributes one concrete step sequence
        return node.action === 'root' ? 0 : 1;
    }
    // AND vs OR semantics
    if (node.action === 'craft' || node.action === 'require' || node.operator === 'AND') {
        let total = 1;
        for (const child of node.children) total *= countActionPaths(child);
        return total;
    }
    // Default OR semantics (root, mine group, hunt group)
    let sum = 0;
    for (const child of node.children) sum += countActionPaths(child);
    return sum;
}

function logActionPath(path) {
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
    const weight = typeof computePathWeight === 'function' ? computePathWeight(path) : 0;
    console.log(`${parts.join(' -> ')} (w=${weight})`);
}

function logActionPaths(paths) {
    paths.forEach((p, idx) => {
        process.stdout.write(`#${idx + 1} `);
        logActionPath(p);
    });
}

function enumerateShortestPathsGenerator(tree, options = {}) {
    const invObj = options && options.inventory && typeof options.inventory === 'object' ? options.inventory : null;
    function MinHeap(compare) {
        this.compare = compare; this.data = [];
    }
    MinHeap.prototype.push = function (item) {
        const a = this.data; a.push(item); let i = a.length - 1;
        while (i > 0) { const p = Math.floor((i - 1) / 2); if (this.compare(a[i], a[p]) >= 0) break; const t = a[i]; a[i] = a[p]; a[p] = t; i = p; }
    };
    MinHeap.prototype.pop = function () {
        const a = this.data; if (a.length === 0) return undefined; const top = a[0]; const last = a.pop();
        if (a.length) { a[0] = last; let i = 0; while (true) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < a.length && this.compare(a[l], a[s]) < 0) s = l; if (r < a.length && this.compare(a[r], a[s]) < 0) s = r; if (s === i) break; const t = a[i]; a[i] = a[s]; a[s] = t; i = s; } }
        return top;
    };
    MinHeap.prototype.size = function () { return this.data.length; };

    function makeLeafStream(step) { return function* () { yield { path: [step], length: 1 }; }; }

    // Build persistent set (all tools + crafting_table + furnace)
    const persistentNames = (() => {
        const s = new Set(['crafting_table', 'furnace']);
        if (lastMcData) {
            try {
                Object.values(lastMcData.blocks || {}).forEach(b => {
                    if (b && b.harvestTools) {
                        Object.keys(b.harvestTools).forEach(id => {
                            const nm = lastMcData.items[id]?.name || String(id);
                            if (nm) s.add(nm);
                        });
                    }
                });
                const toolSuffixes = new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']);
                Object.keys(lastMcData.itemsByName || {}).forEach(n => {
                    const base = getSuffixTokenFromName(n);
                    if (toolSuffixes.has(base)) s.add(n);
                });
            } catch (_) { /* ignore */ }
        }
        return s;
    })();
    function isPersistent(name) { return !!name && persistentNames.has(name); }
    function makeSupplyFromInventory(inv) {
        const m = new Map();
        if (!inv) return m;
        for (const [k, v] of Object.entries(inv)) {
            const n = Number(v);
            if (!Number.isNaN(n) && n > 0) m.set(k, n);
        }
        return m;
    }
    const initialSupply = makeSupplyFromInventory(invObj);

    function sanitizePath(path) {
        // Pass 1: remove duplicate acquisitions of persistent items
        const have = new Map();
        // seed with inventory persistent items
        for (const [k, v] of initialSupply.entries()) { if (isPersistent(k)) have.set(k, (have.get(k) || 0) + v); }
        const keepForward = new Array(path.length).fill(true);
        function produced(step) {
            if (!step) return null;
            if (step.action === 'craft' && step.result && step.result.item) return step.result.item;
            if (step.action === 'smelt' && step.result && step.result.item) return step.result.item;
            if ((step.action === 'mine' || step.action === 'hunt') && (step.targetItem || step.what)) return (step.targetItem || step.what);
            return null;
        }
        function addHave(name) { if (!name) return; have.set(name, (have.get(name) || 0) + 1); }
        function hasHave(name) { return have.has(name) && have.get(name) > 0; }
        for (let i = 0; i < path.length; i++) {
            const step = path[i];
            const prod = produced(step);
            if (prod && isPersistent(prod)) {
                if (hasHave(prod)) { keepForward[i] = false; continue; }
                addHave(prod);
            }
        }
        const filtered = path.filter((_, idx) => keepForward[idx]);

        // Pass 2: trim only suffix gather steps that are not demanded
        const need = new Map();
        // Note: Do not consume inventory during sanitization. We only use inventory at validation time.
        function familyGenericKey(name) {
            if (!name) return null;
            const base = getSuffixTokenFromName(name);
            return baseHasMultipleWoodSpecies(base) ? `generic_${base}` : null;
        }
        function takeFromFamilySpecifics(base, count) {
            if (count <= 0) return 0;
            let remaining = count;
            if (!woodSpeciesTokens) return 0;
            for (const species of woodSpeciesTokens) {
                if (remaining <= 0) break;
                const candidate = `${species}_${base}`;
                if (!lastMcData?.itemsByName?.[candidate]) continue;
                const cur = supply.get(candidate) || 0;
                if (cur <= 0) continue;
                const take = Math.min(cur, remaining);
                supply.set(candidate, cur - take);
                remaining -= take;
            }
            return count - remaining;
        }
        const keep = new Array(filtered.length).fill(false);
        function takeFromSupply(name, count) { return 0; }
        function incNeed(name, count) {
            if (!name || count <= 0) return;
            const covered = takeFromSupply(name, count);
            const remain = count - covered;
            if (remain > 0) need.set(name, (need.get(name) || 0) + remain);
        }
        function decNeed(name, count) { if (!name || count <= 0) return; const cur = need.get(name) || 0; const next = cur - count; if (next > 0) need.set(name, next); else need.delete(name); }
        for (let i = filtered.length - 1; i >= 0; i--) {
            const st = filtered[i];
            if (!st) continue;
            if (st.action === 'smelt') {
                keep[i] = true;
                const inCount = (st.input?.perSmelt || 1) * (st.count || 1);
                incNeed(st.input?.item, inCount);
                if (st.fuel) {
                    try {
                        const perFuel = getSmeltsPerUnitForFuel(st.fuel) || 0;
                        const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1);
                        incNeed(st.fuel, fuelNeed);
                    } catch (_) { incNeed(st.fuel, 1); }
                }
                continue;
            }
            if (st.action === 'craft') {
                keep[i] = true;
                if (Array.isArray(st.ingredients)) {
                    for (const ing of st.ingredients) incNeed(ing?.item, (ing?.perCraftCount || 0) * (st.count || 1));
                }
                const out = st.result?.item;
                if (out) decNeed(out, (st.result?.perCraftCount || 1) * (st.count || 1));
                continue;
            }
            if (st.action === 'mine' || st.action === 'hunt') {
                const out = st.targetItem || st.what;
                const demand = need.get(out) || 0;
                if (demand > 0) {
                    keep[i] = true;
                    decNeed(out, st.count || 1);
                } else {
                    keep[i] = false;
                }
                continue;
            }
            keep[i] = true;
        }
        const out = filtered.filter((_, idx) => keep[idx]);
        // Safety: never drop valid paths. If sanitization breaks feasibility, return original.
        try {
            if (!isPathValid(out)) return path;
        } catch (_) { /* if validator throws, be conservative */ return path; }
        return out;
    }

    function isPathValid(path) {
        const supply = new Map(initialSupply);
        function familyGenericKey(name) { if (!name) return null; const base = getSuffixTokenFromName(name); return baseHasMultipleWoodSpecies(base) ? `generic_${base}` : null; }
        function takeFromFamilySpecifics(base, count) {
            if (count <= 0) return 0;
            let remaining = count;
            if (!woodSpeciesTokens) return 0;
            for (const species of woodSpeciesTokens) {
                if (remaining <= 0) break;
                const candidate = `${species}_${base}`;
                if (!lastMcData?.itemsByName?.[candidate]) continue;
                const cur = supply.get(candidate) || 0;
                if (cur <= 0) continue;
                const take = Math.min(cur, remaining);
                supply.set(candidate, cur - take);
                remaining -= take;
            }
            return count - remaining;
        }
        function add(name, count) { if (!name || count <= 0) return; supply.set(name, (supply.get(name) || 0) + count); }
        function take(name, count) {
            if (!name || count <= 0) return true;
            let cur = supply.get(name) || 0;
            if (cur >= count) { supply.set(name, cur - count); return true; }
            // Try generic family bucket then specifics
            const fam = familyGenericKey(name);
            if (!fam) return false;
            let missing = count - cur;
            if (cur > 0) supply.set(name, 0);
            let gcur = supply.get(fam) || 0;
            if (gcur > 0) {
                const use = Math.min(gcur, missing);
                gcur -= use;
                supply.set(fam, gcur);
                missing -= use;
            }
            if (missing <= 0) return true;
            const base = getSuffixTokenFromName(name);
            const took = takeFromFamilySpecifics(base, missing);
            return took >= missing;
        }
        function produced(step) { return step && (step.targetItem || step.what); }
        for (const st of path) {
            if (!st) continue;
            if (st.action === 'mine' || st.action === 'hunt') {
                const prod = produced(st);
                add(prod, st.count || 1);
                continue;
            }
            if (st.action === 'craft') {
                // Check ingredients
                if (Array.isArray(st.ingredients)) {
                    for (const ing of st.ingredients) {
                        const need = (ing?.perCraftCount || 0) * (st.count || 1);
                        if (!take(ing?.item, need)) return false;
                    }
                }
                // Add result
                const resCount = (st.result?.perCraftCount || 1) * (st.count || 1);
                add(st.result?.item, resCount);
                continue;
            }
            if (st.action === 'smelt') {
                const inCount = (st.input?.perSmelt || 1) * (st.count || 1);
                if (!take(st.input?.item, inCount)) return false;
                if (st.fuel) {
                    try {
                        const perFuel = getSmeltsPerUnitForFuel(st.fuel) || 0;
                        const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1);
                        if (!take(st.fuel, fuelNeed)) return false;
                    } catch (_) {
                        // If unknown fuel rate, require at least 1 unit
                        if (!take(st.fuel, 1)) return false;
                    }
                }
                const outCount = (st.result?.perSmelt || 1) * (st.count || 1);
                add(st.result?.item, outCount);
                continue;
            }
        }
        return true;
    }

    function makeOrStream(childStreams) {
        return function* () {
            const heap = new MinHeap((a, b) => a.item.length - b.item.length);
            const gens = childStreams.map(s => s());
            gens.forEach((g, idx) => { const n = g.next(); if (!n.done) heap.push({ idx, gen: g, item: n.value }); });
            while (heap.size() > 0) { const { idx, gen, item } = heap.pop(); yield item; const n = gen.next(); if (!n.done) heap.push({ idx, gen, item: n.value }); }
        };
    }

    function makeAndStream(childStreams, parentStepOrNull) {
        return function* () {
            const streams = childStreams.map(s => ({ gen: s(), buf: [], done: false }));
            function ensure(i, j) {
                const st = streams[i];
                while (!st.done && st.buf.length <= j) { const n = st.gen.next(); if (n.done) { st.done = true; break; } st.buf.push(n.value); }
                return st.buf.length > j;
            }
            for (let i = 0; i < streams.length; i++) { if (!ensure(i, 0)) return; }
            const heap = new MinHeap((a, b) => a.length - b.length);
            const visited = new Set();
            const initIdx = new Array(streams.length).fill(0);
            function idxKey(idxArr) { return idxArr.join(','); }
            function sumLen(idxArr) { let s = 0; for (let i = 0; i < idxArr.length; i++) s += streams[i].buf[idxArr[i]].length; if (parentStepOrNull) s += 1; return s; }
            heap.push({ idx: initIdx, length: sumLen(initIdx) }); visited.add(idxKey(initIdx));
            while (heap.size() > 0) {
                const node = heap.pop();
                const parts = []; for (let i = 0; i < node.idx.length; i++) parts.push(streams[i].buf[node.idx[i]].path);
                let combined = parts.flat(); if (parentStepOrNull) combined = combined.concat([parentStepOrNull]);
                let cleaned = sanitizePath(combined);
                // If sanitizer returns an invalid result, fall back to combined. If combined invalid too, yield combined conservatively.
                if (!isPathValid(cleaned)) cleaned = combined;
                if (!isPathValid(cleaned)) { yield { path: combined, length: combined.length }; }
                else { yield { path: cleaned, length: cleaned.length }; }
                for (let d = 0; d < streams.length; d++) {
                    const nextIdx = node.idx.slice(); nextIdx[d] += 1; if (!ensure(d, nextIdx[d])) continue; const k = idxKey(nextIdx); if (visited.has(k)) continue; visited.add(k); heap.push({ idx: nextIdx, length: sumLen(nextIdx) });
                }
            }
        };
    }

    function makeStream(node) {
        if (!node) return function* () { };
        if (!node.children || node.children.length === 0) {
            if (node.action === 'craft') { return makeLeafStream({ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }); }
            if (node.action === 'smelt') { return makeLeafStream({ action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }); }
            if (node.action === 'mine' || node.action === 'hunt') { return makeLeafStream({ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool, targetItem: node.targetItem }); }
            if (node.action === 'require') return function* () { };
            return function* () { };
        }
        if (node.action === 'root') { return makeOrStream((node.children || []).map(makeStream)); }
        if (node.action === 'smelt') {
            if (node.operator === 'OR') return makeOrStream((node.children || []).map(makeStream));
            const step = { action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel };
            return makeAndStream((node.children || []).map(makeStream), step);
        }
        if (node.action === 'mine' || node.action === 'hunt') { if (node.operator === 'OR') return makeOrStream((node.children || []).map(makeStream)); }
        if (node.action === 'require') { return makeAndStream((node.children || []).map(makeStream), null); }
        if (node.action === 'craft') { const step = { action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }; return makeAndStream((node.children || []).map(makeStream), step); }
        return makeOrStream((node.children || []).map(makeStream));
    }
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) yield item.path; })();
}

function enumerateLowestWeightPathsGenerator(tree, options = {}) {
    const invObj = options && options.inventory && typeof options.inventory === 'object' ? options.inventory : null;
    function MinHeap(compare) { this.compare = compare; this.data = []; }
    MinHeap.prototype.push = function (item) { const a = this.data; a.push(item); let i = a.length - 1; while (i > 0) { const p = Math.floor((i - 1) / 2); if (this.compare(a[i], a[p]) >= 0) break; const t = a[i]; a[i] = a[p]; a[p] = t; i = p; } };
    MinHeap.prototype.pop = function () { const a = this.data; if (a.length === 0) return undefined; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; while (true) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < a.length && this.compare(a[l], a[s]) < 0) s = l; if (r < a.length && this.compare(a[r], a[s]) < 0) s = r; if (s === i) break; const t = a[i]; a[i] = a[s]; a[s] = t; i = s; } } return top; };
    MinHeap.prototype.size = function () { return this.data.length; };

    function stepWeight(step) {
        if (!step || !step.action) return 0;
        const count = Number(step.count) || 0;
        if (count <= 0) return 0;
        if (step.action === 'craft') return (step.what === 'inventory' ? 1 : 10) * count;
        if (step.action === 'smelt') return 100 * count;
        if (step.action === 'mine') return 1000 * count;
        if (step.action === 'hunt') return 10000 * count;
        return 0;
    }

    function makeLeafStream(step) { const w = stepWeight(step); return function* () { yield { path: [step], weight: w }; }; }

    // Inventory support mirrors shortest generator
    const persistentNames = (() => {
        const s = new Set(['crafting_table', 'furnace']);
        if (lastMcData) {
            try {
                Object.values(lastMcData.blocks || {}).forEach(b => {
                    if (b && b.harvestTools) {
                        Object.keys(b.harvestTools).forEach(id => { const nm = lastMcData.items[id]?.name || String(id); if (nm) s.add(nm); });
                    }
                });
                const toolSuffixes = new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']);
                Object.keys(lastMcData.itemsByName || {}).forEach(n => { const base = getSuffixTokenFromName(n); if (toolSuffixes.has(base)) s.add(n); });
            } catch (_) { }
        }
        return s;
    })();
    function isPersistent(name) { return !!name && persistentNames.has(name); }
    function makeSupplyFromInventory(inv) { const m = new Map(); if (!inv) return m; for (const [k, v] of Object.entries(inv)) { const n = Number(v); if (!Number.isNaN(n) && n > 0) m.set(k, n); } return m; }
    const initialSupply = makeSupplyFromInventory(invObj);

    function sanitizePath(path) {
        const have = new Map();
        for (const [k, v] of initialSupply.entries()) { if (isPersistent(k)) have.set(k, (have.get(k) || 0) + v); }
        const keepForward = new Array(path.length).fill(true);
        function produced(step) { if (!step) return null; if (step.action === 'craft' && step.result && step.result.item) return step.result.item; if (step.action === 'smelt' && step.result && step.result.item) return step.result.item; if ((step.action === 'mine' || step.action === 'hunt') && (step.targetItem || step.what)) return (step.targetItem || step.what); return null; }
        function addHave(name) { if (!name) return; have.set(name, (have.get(name) || 0) + 1); }
        function hasHave(name) { return have.has(name) && have.get(name) > 0; }
        for (let i = 0; i < path.length; i++) { const st = path[i]; const prod = produced(st); if (prod && isPersistent(prod)) { if (hasHave(prod)) { keepForward[i] = false; continue; } addHave(prod); } }
        const filtered = path.filter((_, idx) => keepForward[idx]);
        const need = new Map();
        const supply = new Map(initialSupply);
        const keep = new Array(filtered.length).fill(false);
        function takeFromSupply(name, count) { if (!name || count <= 0) return 0; const cur = supply.get(name) || 0; if (cur <= 0) return 0; const take = Math.min(cur, count); supply.set(name, cur - take); return take; }
        function incNeed(name, count) { if (!name || count <= 0) return; need.set(name, (need.get(name) || 0) + count); }
        function decNeed(name, count) { if (!name || count <= 0) return; const cur = need.get(name) || 0; const next = cur - count; if (next > 0) need.set(name, next); else need.delete(name); }
        for (let i = filtered.length - 1; i >= 0; i--) {
            const st = filtered[i]; if (!st) continue;
            if (st.action === 'smelt') { keep[i] = true; const inCount = (st.input?.perSmelt || 1) * (st.count || 1); incNeed(st.input?.item, inCount); if (st.fuel) { try { const perFuel = getSmeltsPerUnitForFuel(st.fuel) || 0; const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1); incNeed(st.fuel, fuelNeed); } catch (_) { incNeed(st.fuel, 1); } } continue; }
            if (st.action === 'craft') { keep[i] = true; if (Array.isArray(st.ingredients)) { for (const ing of st.ingredients) incNeed(ing?.item, (ing?.perCraftCount || 0) * (st.count || 1)); } const out = st.result?.item; if (out) decNeed(out, (st.result?.perCraftCount || 1) * (st.count || 1)); continue; }
            if (st.action === 'mine' || st.action === 'hunt') { const out = st.targetItem || st.what; const demand = need.get(out) || 0; if (demand > 0) { keep[i] = true; decNeed(out, st.count || 1); } else { keep[i] = false; } continue; }
            keep[i] = true;
        }
        return filtered.filter((_, idx) => keep[idx]);
    }

    function isPathValid(path) {
        const supply = new Map(initialSupply);
        function add(name, count) { if (!name || count <= 0) return; supply.set(name, (supply.get(name) || 0) + count); }
        function take(name, count) { if (!name || count <= 0) return true; const cur = supply.get(name) || 0; if (cur < count) return false; supply.set(name, cur - count); return true; }
        function produced(step) { return step && (step.targetItem || step.what); }
        for (const st of path) {
            if (!st) continue;
            if (st.action === 'mine' || st.action === 'hunt') { const prod = produced(st); add(prod, st.count || 1); continue; }
            if (st.action === 'craft') { if (Array.isArray(st.ingredients)) { for (const ing of st.ingredients) { const need = (ing?.perCraftCount || 0) * (st.count || 1); if (!take(ing?.item, need)) return false; } } const resCount = (st.result?.perCraftCount || 1) * (st.count || 1); add(st.result?.item, resCount); continue; }
            if (st.action === 'smelt') { const inCount = (st.input?.perSmelt || 1) * (st.count || 1); if (!take(st.input?.item, inCount)) return false; if (st.fuel) { try { const perFuel = getSmeltsPerUnitForFuel(st.fuel) || 0; const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1); if (!take(st.fuel, fuelNeed)) return false; } catch (_) { if (!take(st.fuel, 1)) return false; } } const outCount = (st.result?.perSmelt || 1) * (st.count || 1); add(st.result?.item, outCount); continue; }
        }
        return true;
    }

    function makeOrStream(childStreams) {
        return function* () {
            const heap = new MinHeap((a, b) => a.item.weight - b.item.weight);
            const gens = childStreams.map(s => s());
            gens.forEach((g, idx) => { const n = g.next(); if (!n.done) heap.push({ idx, gen: g, item: n.value }); });
            while (heap.size() > 0) { const { idx, gen, item } = heap.pop(); yield item; const n = gen.next(); if (!n.done) heap.push({ idx, gen, item: n.value }); }
        };
    }

    function makeAndStream(childStreams, parentStepOrNull) {
        return function* () {
            const streams = childStreams.map(s => ({ gen: s(), buf: [], done: false }));
            function ensure(i, j) { const st = streams[i]; while (!st.done && st.buf.length <= j) { const n = st.gen.next(); if (n.done) { st.done = true; break; } st.buf.push(n.value); } return st.buf.length > j; }
            for (let i = 0; i < streams.length; i++) { if (!ensure(i, 0)) return; }
            const heap = new MinHeap((a, b) => a.weight - b.weight);
            const visited = new Set();
            const initIdx = new Array(streams.length).fill(0);
            function idxKey(idxArr) { return idxArr.join(','); }
            function sumWeight(idxArr) { let s = 0; for (let i = 0; i < idxArr.length; i++) s += streams[i].buf[idxArr[i]].weight; if (parentStepOrNull) s += stepWeight(parentStepOrNull); return s; }
            heap.push({ idx: initIdx, weight: sumWeight(initIdx) }); visited.add(idxKey(initIdx));
            while (heap.size() > 0) {
                const node = heap.pop();
                const parts = []; for (let i = 0; i < node.idx.length; i++) parts.push(streams[i].buf[node.idx[i]].path);
                let combined = parts.flat(); if (parentStepOrNull) combined = combined.concat([parentStepOrNull]);
                let cleaned = sanitizePath(combined);
                if (!isPathValid(cleaned)) cleaned = combined;
                if (!isPathValid(cleaned)) { yield { path: combined, weight: computePathWeight(combined) }; }
                else { yield { path: cleaned, weight: computePathWeight(cleaned) }; }
                for (let d = 0; d < streams.length; d++) {
                    const nextIdx = node.idx.slice(); nextIdx[d] += 1; if (!ensure(d, nextIdx[d])) continue; const k = idxKey(nextIdx); if (visited.has(k)) continue; visited.add(k); heap.push({ idx: nextIdx, weight: sumWeight(nextIdx) });
                }
            }
        };
    }

    function makeStream(node) {
        if (!node) return function* () { };
        if (!node.children || node.children.length === 0) {
            if (node.action === 'craft') { return makeLeafStream({ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }); }
            if (node.action === 'smelt') { return makeLeafStream({ action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }); }
            if (node.action === 'mine' || node.action === 'hunt') { return makeLeafStream({ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool, targetItem: node.targetItem }); }
            if (node.action === 'require') return function* () { };
            return function* () { };
        }
        if (node.action === 'root') { return makeOrStream((node.children || []).map(makeStream)); }
        if (node.action === 'smelt') { if (node.operator === 'OR') return makeOrStream((node.children || []).map(makeStream)); const step = { action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }; return makeAndStream((node.children || []).map(makeStream), step); }
        if (node.action === 'mine' || node.action === 'hunt') { if (node.operator === 'OR') return makeOrStream((node.children || []).map(makeStream)); }
        if (node.action === 'require') { return makeAndStream((node.children || []).map(makeStream), null); }
        if (node.action === 'craft') { const step = { action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }; return makeAndStream((node.children || []).map(makeStream), step); }
        return makeOrStream((node.children || []).map(makeStream));
    }
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) yield item.path; })();
}

function computePathWeight(path) {
    if (!Array.isArray(path)) return 0;
    let total = 0;
    for (const step of path) {
        if (!step || !step.action) continue;
        const count = Number(step.count) || 0;
        if (count <= 0) continue;
        if (step.action === 'craft') {
            total += (step.what === 'inventory' ? 1 : 10) * count;
        } else if (step.action === 'smelt') {
            total += 100 * count;
        } else if (step.action === 'mine') {
            total += 1000 * count;
        } else if (step.action === 'hunt') {
            total += 10000 * count;
        }
    }
    return total;
}

analyzeRecipes._internals = {
    resolveMcData,
    requiresCraftingTable,
    renderName,
    genericizeItemName,
    chooseMinimalToolName,
    findBlocksThatDrop,
    printMiningPath,
    getIngredientCounts,
    hasCircularDependency,
    printRecipeConversion,
    findMobsThatDrop,
    printHuntingPath,
    buildRecipeTree,
    logRecipeTree,
    enumerateActionPaths,
    enumerateShortestPathsGenerator,
    enumerateActionPathsGenerator,
    computeTreeMaxDepth,
    countActionPaths,
    logActionPath,
    logActionPaths,
    computePathWeight,
    enumerateLowestWeightPathsGenerator
};

module.exports = analyzeRecipes;
