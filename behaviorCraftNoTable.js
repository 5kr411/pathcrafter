const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
} = require('mineflayer-statemachine')

const { getItemCountInInventory } = require('./util')

const minecraftData = require('minecraft-data')

function createCraftNoTableState(bot, targets) {
    const enter = new BehaviorIdle()

    const waitForCraft = new BehaviorIdle()

    const exit = new BehaviorIdle()

    const craftItemNoTable = async (itemName, amount, maxRetries = 3) => {
        const mcData = minecraftData(bot.version)
        const item = mcData.itemsByName[itemName];

        if (!item) {
            console.log(`Item ${itemName} not found`);
            return false;
        }

        const recipe = bot.recipesFor(item.id, null, 1, null).find(r => !r.requiresTable);
        if (!recipe) {
            console.log(`No recipe found for ${itemName} that doesn't require a crafting table`);
            return false;
        }

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await bot.craft(recipe, amount, null);
                console.log(`Successfully crafted ${itemName} ${amount} times, ${getItemCountInInventory(bot, itemName)}/${targets.expectedQuantityAfterCraft} items in inventory`);
                return true;
            } catch (err) {
                console.log(`Error crafting ${itemName} (Attempt ${attempt}/${maxRetries}):`, err);
                if (attempt === maxRetries) {
                    console.log(`Max retries reached for crafting ${itemName}`);
                    return false;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    };

    let waitForCraftStartTime
    const enterToWaitForCraft = new StateTransition({
        parent: enter,
        child: waitForCraft,
        name: 'BehaviorCraftNoTable: enter -> wait for craft',
        shouldTransition: () => true,
        onTransition: async () => {
            waitForCraftStartTime = Date.now()
            console.log('BehaviorCraftNoTable: enter -> wait for craft')
            await craftItemNoTable(targets.itemNameToCraft, targets.timesToCraft, 3)
        }
    })

    const waitForCraftToExit = new StateTransition({
        parent: waitForCraft,
        child: exit,
        name: 'BehaviorCraftNoTable: wait for craft -> exit',
        shouldTransition: () => getItemCountInInventory(bot, targets.itemNameToCraft) >= targets.expectedQuantityAfterCraft || Date.now() - waitForCraftStartTime > 3500,
        onTransition: () => {
            console.log('BehaviorCraftNoTable: wait for craft -> exit')
        }
    })

    const transitions = [enterToWaitForCraft, waitForCraftToExit]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createCraftNoTableState;
