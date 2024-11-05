const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine
} = require('mineflayer-statemachine')

const minecraftData = require('minecraft-data')

const { getItemCountInInventory } = require('./util')

const createCraftWithTableState = (bot, targets) => {
    const craftItemWithTable = async (itemName, additionalNeeded) => {
        const mcData = minecraftData(bot.version);
        const item = mcData.itemsByName[itemName];

        if (!item) {
            console.log(`BehaviorCraftWithTable: Item ${itemName} not found`);
            return false;
        }

        const craftingTable = bot.findBlock({
            matching: block => block.name === 'crafting_table',
            maxDistance: 3
        });

        if (!craftingTable) {
            console.log(`BehaviorCraftWithTable: No crafting table within range`);
            return false;
        }

        console.log(`BehaviorCraftWithTable: Searching for recipes for ${itemName} (id: ${item.id})`);
        const recipes = bot.recipesFor(item.id, null, 1, craftingTable);
        console.log(`BehaviorCraftWithTable: Found ${recipes.length} recipes`);

        const recipe = recipes[0];

        if (!recipe) {
            console.log(`BehaviorCraftWithTable: No recipe found for ${itemName}. Available recipes: ${recipes.length}`);
            return false;
        }

        const startingCount = getItemCountInInventory(bot, itemName);
        const targetCount = startingCount + additionalNeeded;
        let currentCount = startingCount;

        console.log(`BehaviorCraftWithTable: Starting with ${startingCount} ${itemName}, need ${additionalNeeded} more (target: ${targetCount})`);

        const hasIngredients = recipe.delta.filter(item => item.count < 0)
            .every(item => {
                const requiredCount = Math.abs(item.count);
                const availableCount = getItemCountInInventory(bot, mcData.items[item.id].name);
                const hasEnough = availableCount >= requiredCount;

                if (!hasEnough) {
                    console.log(`BehaviorCraftWithTable: Missing ingredients. Need ${requiredCount} ${mcData.items[item.id].name} but only have ${availableCount}`);
                }

                return hasEnough;
            });

        if (!hasIngredients) {
            console.log(`BehaviorCraftWithTable: Cannot craft ${itemName} - missing ingredients`);
            return false;
        }

        try {
            const remainingNeeded = targetCount - currentCount;
            const timesToCraft = Math.min(Math.ceil(remainingNeeded / recipe.result.count), Math.floor(64 / recipe.result.count));

            console.log(`BehaviorCraftWithTable: Attempting to craft ${timesToCraft} times`);

            await bot.craft(recipe, timesToCraft, craftingTable);

            const newCount = getItemCountInInventory(bot, itemName);
            console.log(`BehaviorCraftWithTable: Successfully crafted. Inventory now has ${newCount}/${targetCount} ${itemName} (started with ${startingCount})`);

            if (newCount === currentCount) {
                console.log('BehaviorCraftWithTable: Crafting did not increase item count');
                return false;
            }

            return newCount >= targetCount;

        } catch (err) {
            console.log(`BehaviorCraftWithTable: Error crafting ${itemName}:`, err);
            return false;
        }
    }

    const enter = new BehaviorIdle()
    const waitForCraft = new BehaviorIdle()
    const exit = new BehaviorIdle()

    const enterToExit = new StateTransition({
        parent: enter,
        child: exit,
        name: 'BehaviorCraftWithTable: enter -> exit',
        shouldTransition: () => targets.itemName == null || targets.amount == null,
        onTransition: () => {
            if (targets.itemName == null) {
                console.log('BehaviorCraftWithTable: Error: No item name')
            }
            if (targets.amount == null) {
                console.log('BehaviorCraftWithTable: Error: No amount')
            }
            console.log('BehaviorCraftWithTable: enter -> exit')
        }
    })

    let waitForCraftStartTime
    const enterToWaitForCraft = new StateTransition({
        parent: enter,
        child: waitForCraft,
        name: 'BehaviorCraftWithTable: enter -> wait for craft',
        shouldTransition: () => targets.itemName != null && targets.amount != null,
        onTransition: () => {
            waitForCraftStartTime = Date.now()
            console.log('BehaviorCraftWithTable: enter -> wait for craft')
            craftItemWithTable(targets.itemName, targets.amount)
        }
    })

    const waitForCraftToExit = new StateTransition({
        parent: waitForCraft,
        child: exit,
        name: 'BehaviorCraftWithTable: wait for craft -> exit',
        shouldTransition: () => getItemCountInInventory(bot, targets.itemName) >= targets.amount || Date.now() - waitForCraftStartTime > 5000,
        onTransition: () => {
            console.log('BehaviorCraftWithTable: wait for craft -> exit')
        }
    })

    const transitions = [
        enterToExit,
        enterToWaitForCraft,
        waitForCraftToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}


module.exports = createCraftWithTableState;
