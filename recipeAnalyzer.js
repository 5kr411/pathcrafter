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

function analyzeRecipes(bot, itemName, targetCount = 1, depth = 0, craftingHistory = new Set()) {
    const mcData = minecraftData(bot.version);
    const item = mcData.itemsByName[itemName];

    if (!item) {
        console.log(`${' '.repeat(depth * 4)}Cannot find item: ${itemName}`);
        return;
    }

    if (craftingHistory.has(itemName)) {
        console.log(`${' '.repeat(depth * 4)}↻ ${itemName} (circular dependency)`);
        const sources = findBlocksThatDrop(mcData, itemName);
        if (sources.length > 0) {
            console.log(`${' '.repeat(depth * 4)}  Can be obtained by mining:`);
            sources.forEach(source => {
                console.log(`${' '.repeat(depth * 4)}  - ${source.block} (requires: ${source.tool})`);
            });
        }
        return;
    }

    const recipes = (mcData.recipes[item.id] || [])
        .sort((a, b) => b.result.count - a.result.count);

    if (recipes.length === 0) {
        console.log(`${' '.repeat(depth * 4)}→ ${itemName} needed: ${targetCount}`);
        const sources = findBlocksThatDrop(mcData, itemName);
        if (sources.length > 0) {
            console.log(`${' '.repeat(depth * 4)}  Can be obtained by mining:`);
            sources.forEach(source => {
                console.log(`${' '.repeat(depth * 4)}  - ${source.block} (requires: ${source.tool})`);
            });
        }
        return;
    }

    craftingHistory.add(itemName);

    recipes.forEach((recipe, index) => {
        const craftingLocation = requiresCraftingTable(recipe) ? 'table' : 'inventory';
        const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);

        console.log(`${' '.repeat(depth * 4)}+ ${itemName} (Recipe ${index + 1}/${recipes.length}, ${craftingLocation})`);
        console.log(`${' '.repeat(depth * 4)}  Want: ${targetCount}, Recipe makes: ${recipe.result.count}, Need to craft: ${craftingsNeeded}x`);

        const ingredientCounts = new Map();

        if (recipe.ingredients) {
            recipe.ingredients.forEach(ingredient => {
                if (mcData.items[ingredient]) {
                    const currentCount = ingredientCounts.get(ingredient) || 0;
                    ingredientCounts.set(ingredient, currentCount + 1);
                }
            });
        } else if (recipe.inShape) {
            recipe.inShape.forEach(row => {
                row.forEach(ingredientId => {
                    if (ingredientId) {
                        const currentCount = ingredientCounts.get(ingredientId) || 0;
                        ingredientCounts.set(ingredientId, currentCount + 1);
                    }
                });
            });
        }

        ingredientCounts.forEach((count, ingredientId) => {
            const ingredientItem = mcData.items[ingredientId];
            if (ingredientItem) {
                const newHistory = new Set(craftingHistory);
                analyzeRecipes(bot, ingredientItem.name, count * craftingsNeeded, depth + 1, newHistory);
            }
        });
    });
}

module.exports = analyzeRecipes;
