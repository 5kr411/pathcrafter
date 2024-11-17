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

    // Check all blocks for drops
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

function analyzeRecipes(bot, itemName, targetCount = 1, depth = 1, craftingHistory = new Set()) {
    const mcData = minecraftData(bot.version);
    const item = mcData.itemsByName[itemName];

    if (!item) {
        console.log(`${' '.repeat(depth * 2)}Cannot find item: ${itemName}`);
        return { materials: new Map() };
    }

    // Print item header
    console.log(`${' '.repeat(depth * 2)}├─ ${itemName} (want ${targetCount})`);

    // Always check and show mining path if available
    const sources = findBlocksThatDrop(mcData, itemName);
    if (sources.length > 0) {
        console.log(`${' '.repeat((depth + 1) * 2)}├─ mine (${targetCount}x)`);
        sources.forEach((source, index) => {
            const isLast = index === sources.length - 1;
            console.log(`${' '.repeat((depth + 2) * 2)}${isLast ? '└─' : '├─'} ${source.block}`);
        });
    }

    // Then show crafting paths if available
    const recipes = (mcData.recipes[item.id] || [])
        .sort((a, b) => b.result.count - a.result.count);

    if (recipes.length > 0) {
        recipes.forEach((recipe, recipeIndex) => {
            const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
            const isLastRecipe = recipeIndex === recipes.length - 1;
            const craftingLocation = requiresCraftingTable(recipe) ? 'table' : 'inventory';
            console.log(`${' '.repeat((depth + 1) * 2)}${isLastRecipe ? '└─' : '├─'} craft in ${craftingLocation} (${craftingsNeeded}x)`);

            // Get ingredients and their counts
            const ingredients = recipe.ingredients || recipe.inShape?.flat().filter(Boolean);
            const ingredientCounts = new Map();

            if (ingredients) {
                // Sort ingredients by ID first
                const sortedIngredients = [...ingredients].sort((a, b) => a - b);

                // Count ingredients
                sortedIngredients.forEach(id => {
                    ingredientCounts.set(id, (ingredientCounts.get(id) || 0) + 1);
                });

                // Show recipe conversion with sorted ingredients
                const ingredientList = Array.from(ingredientCounts.entries())
                    .sort(([idA], [idB]) => idA - idB)
                    .map(([id, count]) => `${count} ${mcData.items[id].name}`)
                    .join(' + ');
                console.log(`${' '.repeat((depth + 2) * 2)}├─ ${ingredientList} -> ${recipe.result.count} ${itemName}`);

                // Process unique ingredients in sorted order
                Array.from(ingredientCounts.entries())
                    .sort(([idA], [idB]) => idA - idB)
                    .forEach(([ingredientId, count]) => {
                        const ingredientItem = mcData.items[ingredientId];
                        if (ingredientItem) {
                            // Check for circular dependency
                            const ingredientRecipes = mcData.recipes[ingredientItem.id] || [];
                            const wouldCreateCircular = ingredientRecipes.some(r =>
                                (r.ingredients && r.ingredients.includes(item.id)) ||
                                (r.inShape && r.inShape.some(row => row.includes(item.id)))
                            );

                            if (wouldCreateCircular) {
                                // Just show the mining path
                                const sources = findBlocksThatDrop(mcData, ingredientItem.name);
                                if (sources.length > 0) {
                                    console.log(`${' '.repeat((depth + 3) * 2)}└─ mine`);
                                    sources.forEach((source, sourceIndex) => {
                                        const isLast = sourceIndex === sources.length - 1;
                                        console.log(`${' '.repeat((depth + 4) * 2)}${isLast ? '└─' : '├─'} ${source.block}`);
                                    });
                                }
                            } else {
                                analyzeRecipes(bot, ingredientItem.name,
                                    count * craftingsNeeded,
                                    depth + 2,
                                    new Set(craftingHistory));
                            }
                        }
                    });
            }
        });
    }

    return { materials: new Map() };
}

module.exports = analyzeRecipes;
