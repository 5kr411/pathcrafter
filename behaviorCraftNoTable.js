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

    function clearCraftingSlots(bot) {
        const craftingSlotIndices = [1, 2, 3, 4];
        return new Promise((resolve) => {
            let completedSlots = 0;

            craftingSlotIndices.forEach(index => {
                const slot = bot.inventory.slots[index];
                if (!slot) {
                    completedSlots++;
                    if (completedSlots === craftingSlotIndices.length) resolve();
                    return;
                }

                bot.moveSlotItem(index, bot.inventory.firstEmptyInventorySlot())
                    .then(() => {
                        console.log(`BehaviorCraftNoTable: Moved item from crafting slot ${index} to inventory`);
                        completedSlots++;
                        if (completedSlots === craftingSlotIndices.length) resolve();
                    })
                    .catch(err => {
                        console.log(`BehaviorCraftNoTable: Error moving item from crafting slot ${index}:`, err);
                        completedSlots++;
                        if (completedSlots === craftingSlotIndices.length) resolve();
                    });
            });
        });
    }

    const craftItemNoTable = async (itemName, numNeeded, maxRetries = 3) => {
        const mcData = minecraftData(bot.version);
        const item = mcData.itemsByName[itemName];

        if (!item) {
            console.log(`BehaviorCraftNoTable: Item ${itemName} not found`);
            return false;
        }

        const recipe = bot.recipesFor(item.id, null, 1, null).find(r => !r.requiresTable);
        if (!recipe) {
            console.log(`BehaviorCraftNoTable: No recipe found for ${itemName} that doesn't require a crafting table`);
            return false;
        }

        let currentCount = getItemCountInInventory(bot, itemName);
        let attempt = 1;

        while (currentCount < numNeeded && attempt <= maxRetries) {
            try {
                await clearCraftingSlots(bot);

                // Calculate how many more items we need
                const remainingNeeded = numNeeded - currentCount;
                // Calculate how many times we can craft with current recipe
                const timesToCraft = Math.min(Math.ceil(remainingNeeded / recipe.result.count), Math.floor(64 / recipe.result.count));

                console.log(`BehaviorCraftNoTable: Attempting to craft ${timesToCraft} times (Attempt ${attempt}/${maxRetries})`);

                await bot.craft(recipe, timesToCraft, null);

                const newCount = getItemCountInInventory(bot, itemName);
                console.log(`BehaviorCraftNoTable: Successfully crafted. Inventory now has ${newCount}/${numNeeded} ${itemName}`);

                if (newCount === currentCount) {
                    // If count didn't change, something went wrong
                    throw new Error('Crafting did not increase item count');
                }

                currentCount = newCount;

            } catch (err) {
                console.log(`BehaviorCraftNoTable: Error crafting ${itemName} (Attempt ${attempt}/${maxRetries}):`, err);

                if (err.message && err.message.includes('Server rejected transaction')) {
                    await clearCraftingSlots(bot);
                }

                attempt++;
                if (attempt <= maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        return currentCount >= numNeeded;
    };

    let waitForCraftStartTime
    const enterToWaitForCraft = new StateTransition({
        parent: enter,
        child: waitForCraft,
        name: 'BehaviorCraftNoTable: enter -> wait for craft',
        shouldTransition: () => true,
        onTransition: () => {
            waitForCraftStartTime = Date.now()
            console.log('BehaviorCraftNoTable: enter -> wait for craft')
            craftItemNoTable(targets.itemName, targets.numNeeded, 5)
        }
    })

    const waitForCraftToExit = new StateTransition({
        parent: waitForCraft,
        child: exit,
        name: 'BehaviorCraftNoTable: wait for craft -> exit',
        shouldTransition: () => getItemCountInInventory(bot, targets.itemName) >= targets.numNeeded || Date.now() - waitForCraftStartTime > 10000,
        onTransition: () => {
            console.log('BehaviorCraftNoTable: wait for craft -> exit')
        }
    })

    const transitions = [enterToWaitForCraft, waitForCraftToExit]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createCraftNoTableState;
