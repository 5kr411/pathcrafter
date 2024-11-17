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
        console.log(`${' '.repeat(depth * 4)}Cannot find item: ${itemName}`);
        return { materials: new Map() };
    }

    // Print item header
    console.log(`${' '.repeat(depth * 4)}+ ${itemName} (Want: ${targetCount})`);

    if (craftingHistory.has(itemName)) {
        console.log(`${' '.repeat(depth * 4)}  ↻ Circular dependency detected`);
        const sources = findBlocksThatDrop(mcData, itemName);
        if (sources.length > 0) {
            console.log(`${' '.repeat(depth * 4)}  Can be obtained by mining:`);
            sources.forEach(source => {
                console.log(`${' '.repeat(depth * 4)}  - ${source.block} (requires: ${source.tool})`);
            });
        }
        const materials = new Map();
        materials.set(itemName, targetCount);
        return { materials };
    }

    const recipes = (mcData.recipes[item.id] || [])
        .sort((a, b) => b.result.count - a.result.count);

    if (recipes.length === 0) {
        const sources = findBlocksThatDrop(mcData, itemName);
        if (sources.length > 0) {
            console.log(`${' '.repeat(depth * 4)}  Can be obtained by mining:`);
            sources.forEach(source => {
                console.log(`${' '.repeat(depth * 4)}  - ${source.block} (requires: ${source.tool})`);
            });
        }
        const materials = new Map();
        materials.set(itemName, targetCount);
        return { materials };
    }

    craftingHistory.add(itemName);

    // Find best recipe
    let bestRecipe = null;
    let bestMaterials = null;
    let bestTotalMaterials = Infinity;

    for (const recipe of recipes) {
        const craftingLocation = requiresCraftingTable(recipe) ? 'table' : 'inventory';
        const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);

        console.log(`${' '.repeat(depth * 4)}  Recipe makes: ${recipe.result.count}, Need to craft: ${craftingsNeeded}x (${craftingLocation})`);

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

        const recipeMaterials = new Map();
        let totalMaterials = 0;

        // Analyze ingredients
        for (const [ingredientId, count] of ingredientCounts) {
            const ingredientItem = mcData.items[ingredientId];
            if (ingredientItem) {
                const newHistory = new Set(craftingHistory);
                const result = analyzeRecipes(bot, ingredientItem.name, count * craftingsNeeded, depth + 1, newHistory);

                result.materials.forEach((count, material) => {
                    recipeMaterials.set(material, (recipeMaterials.get(material) || 0) + count);
                    totalMaterials += count;
                });
            }
        }

        if (totalMaterials < bestTotalMaterials) {
            bestTotalMaterials = totalMaterials;
            bestMaterials = recipeMaterials;
            bestRecipe = recipe;
        }
    }

    craftingHistory.delete(itemName);
    return { materials: bestMaterials };
}

module.exports = analyzeRecipes;
