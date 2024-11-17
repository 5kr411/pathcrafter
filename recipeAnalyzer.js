const minecraftData = require('minecraft-data')

function requiresCraftingTable(recipe) {
    if (recipe.ingredients) {
        return false;
    }

    if (recipe.inShape) {
        const tooWide = recipe.inShape.some(row => row.length > 2);
        const tooTall = recipe.inShape.length > 2;
        return tooWide || tooTall;
    }

    return false;
}

function analyzeRecipes(bot, itemName, depth = 0, count = 1) {
    const mcData = minecraftData(bot.version);
    const item = mcData.itemsByName[itemName];

    if (!item) {
        console.log(`${' '.repeat(depth * 4)}Item "${itemName}" not found`);
        return;
    }

    const recipes = (mcData.recipes[item.id] || [])
        .sort((a, b) => b.result.count - a.result.count);

    if (recipes.length === 0) {
        // Base item (can't be crafted)
        console.log(`${' '.repeat(depth * 4)}- ${itemName} (${item.id}): base item x${count}`);
        return;
    }

    recipes.forEach(recipe => {
        console.log(`${' '.repeat(depth * 4)}- ${itemName} (${item.id}): ${recipe.result.count} (${requiresCraftingTable(recipe) ? 'table' : 'inventory'})`);

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
                analyzeRecipes(bot, ingredientItem.name, depth + 1, count);
            }
        });
    });
}

module.exports = analyzeRecipes;
