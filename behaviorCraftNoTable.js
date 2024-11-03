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

    const craftItemNoTable = (itemName, amount, maxRetries = 3) => {
        const mcData = minecraftData(bot.version);
        const item = mcData.itemsByName[itemName];

        if (!item) {
            console.log(`BehaviorCraftNoTable: Item ${itemName} not found`);
            return Promise.resolve(false);
        }

        const recipe = bot.recipesFor(item.id, null, 1, null).find(r => !r.requiresTable);
        if (!recipe) {
            console.log(`BehaviorCraftNoTable: No recipe found for ${itemName} that doesn't require a crafting table`);
            return Promise.resolve(false);
        }

        let attempt = 1;

        function attemptCraft() {
            return clearCraftingSlots(bot)
                .then(() => bot.craft(recipe, amount, null))
                .then(() => {
                    console.log(`BehaviorCraftNoTable: Successfully crafted ${itemName} ${amount} times, ${getItemCountInInventory(bot, itemName)}/${targets.expectedQuantityAfterCraft} items in inventory`);
                    return true;
                })
                .catch(err => {
                    console.log(`BehaviorCraftNoTable: Error crafting ${itemName} (Attempt ${attempt}/${maxRetries}):`, err);

                    if (err.message && err.message.includes('Server rejected transaction')) {
                        return clearCraftingSlots(bot)
                            .then(() => {
                                if (attempt < maxRetries) {
                                    attempt++;
                                    return new Promise(resolve => setTimeout(() => resolve(attemptCraft()), 1000));
                                }
                                console.log(`BehaviorCraftNoTable: Max retries reached for crafting ${itemName}`);
                                return false;
                            });
                    }

                    if (attempt < maxRetries) {
                        attempt++;
                        return new Promise(resolve => setTimeout(() => resolve(attemptCraft()), 1000));
                    }
                    console.log(`BehaviorCraftNoTable: Max retries reached for crafting ${itemName}`);
                    return false;
                });
        }

        return attemptCraft();
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
            craftItemNoTable(targets.itemName, targets.timesToCraft, 5)
        }
    })

    const waitForCraftToExit = new StateTransition({
        parent: waitForCraft,
        child: exit,
        name: 'BehaviorCraftNoTable: wait for craft -> exit',
        shouldTransition: () => getItemCountInInventory(bot, targets.itemName) >= targets.expectedQuantityAfterCraft || Date.now() - waitForCraftStartTime > 3500,
        onTransition: () => {
            console.log('BehaviorCraftNoTable: wait for craft -> exit')
        }
    })

    const transitions = [enterToWaitForCraft, waitForCraftToExit]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createCraftNoTableState;
