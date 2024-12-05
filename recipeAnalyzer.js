const minecraftData = require('minecraft-data')

function requiresCraftingTable(recipe) {
    if (recipe.ingredients) return false;
    if (recipe.inShape) {
        const tooWide = recipe.inShape.some(row => row.length > 2);
        const tooTall = recipe.inShape.length > 2;
        return tooWide || tooTall;
    }
    return false;
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
    console.log(`${' '.repeat((depth + 2) * 2)}├─ ${ingredientList} -> ${recipe.result.count} ${itemName}`);
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
                    tool: 'weapon',
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

function analyzeRecipes(bot, itemName, targetCount = 1, depth = 1, craftingHistory = new Set()) {
    const mcData = minecraftData(bot.version);
    const item = mcData.itemsByName[itemName];

    if (!item) {
        console.log(`${' '.repeat(depth * 2)}Cannot find item: ${itemName}`);
        return { materials: new Map() };
    }

    // Print item header
    console.log(`${' '.repeat(depth * 2)}├─ ${itemName} (want ${targetCount})`);

    // Show crafting paths first
    const recipes = (mcData.recipes[item.id] || [])
        .sort((a, b) => b.result.count - a.result.count);

    recipes.forEach((recipe, recipeIndex) => {
        const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
        const isLastRecipe = recipeIndex === recipes.length - 1 && !findBlocksThatDrop(mcData, itemName).length;
        const craftingLocation = requiresCraftingTable(recipe) ? 'table' : 'inventory';
        console.log(`${' '.repeat((depth + 1) * 2)}${isLastRecipe ? '└─' : '├─'} craft in ${craftingLocation} (${craftingsNeeded}x)`);

        const ingredientCounts = getIngredientCounts(recipe);
        if (ingredientCounts.size > 0) {
            printRecipeConversion(mcData, ingredientCounts, recipe, itemName, depth);

            // Process ingredients
            Array.from(ingredientCounts.entries())
                .sort(([idA], [idB]) => idA - idB)
                .forEach(([ingredientId, count]) => {
                    const ingredientItem = mcData.items[ingredientId];
                    if (!ingredientItem) return;

                    if (hasCircularDependency(mcData, item.id, ingredientId)) {
                        const sources = findBlocksThatDrop(mcData, ingredientItem.name);
                        if (sources.length > 0) {
                            console.log(`${' '.repeat((depth + 3) * 2)}└─ mine`);
                            sources.forEach((source, sourceIndex) => {
                                const isLast = sourceIndex === sources.length - 1;
                                const toolInfo = source.tool === 'any' ? '' : ` (needs ${source.tool})`;
                                console.log(`${' '.repeat((depth + 4) * 2)}${isLast ? '└─' : '├─'} ${source.block}${toolInfo}`);
                            });
                        }
                    } else {
                        analyzeRecipes(bot, ingredientItem.name,
                            count * craftingsNeeded,
                            depth + 2,
                            new Set(craftingHistory));
                    }
                });
        }
    });

    // Show mining path
    const miningPaths = findBlocksThatDrop(mcData, itemName);
    if (miningPaths.length > 0) {
        printMiningPath(miningPaths, depth, targetCount);
    }

    // Show hunting path last
    const huntingPaths = findMobsThatDrop(mcData, itemName);
    if (huntingPaths.length > 0) {
        printHuntingPath(huntingPaths, depth, targetCount);
    }

    return { materials: new Map() };
}

module.exports = analyzeRecipes;
