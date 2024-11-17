const minecraftData = require('minecraft-data')

function analyzeRecipes(bot, itemName) {
    const mcData = minecraftData(bot.version);
    const item = mcData.itemsByName[itemName];

    if (!item) {
        console.log(`Item "${itemName}" not found`);
        return;
    }

    console.log(`\nDebug Info:`);
    console.log(`Bot version: ${bot.version}`);
    console.log(`Item ID: ${item.id}`);

    // Check if recipes are loaded
    if (!bot.recipes || bot.recipes.length === 0) {
        console.log('\nWARNING: Recipes not yet loaded!');
        console.log('Waiting for recipes to load...');

        // Return a promise that resolves when recipes are loaded
        return new Promise((resolve) => {
            bot.once('recipesAll', () => {
                console.log(`Recipes loaded! Total recipes: ${bot.recipes.length}`);
                analyzeRecipesImpl(bot, itemName, mcData, item);
                resolve();
            });
        });
    }

    return analyzeRecipesImpl(bot, itemName, mcData, item);
}

function analyzeRecipesImpl(bot, itemName, mcData, item) {
    console.log(`\nTotal recipes in bot: ${bot.recipes.length}`);

    // Find recipes for the item
    const itemRecipes = bot.recipes.filter(recipe =>
        recipe.result &&
        recipe.result.item &&
        recipe.result.item.id === item.id
    );

    console.log(`Found ${itemRecipes.length} recipes for ${itemName}\n`);

    itemRecipes.forEach((recipe, index) => {
        console.log(`Recipe #${index + 1}:`);
        console.log(`Requires Table: ${recipe.requiresTable ? 'Yes' : 'No'}`);
        console.log(`Output Count: ${recipe.result.count}`);

        console.log('Ingredients:');
        if (recipe.ingredients && recipe.ingredients.length > 0) {
            recipe.ingredients.forEach(ingredient => {
                const ingredientName = mcData.items[ingredient.id]?.name || `Unknown(${ingredient.id})`;
                console.log(`  - ${ingredient.count}x ${ingredientName}`);
            });
        } else {
            console.log('No ingredient data available');
        }
        console.log(''); // Empty line between recipes
    });
}

module.exports = analyzeRecipes;
