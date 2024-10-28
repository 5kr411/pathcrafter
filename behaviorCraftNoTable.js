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

    async function clearCraftingSlots(bot) {
        const craftingSlotIndices = [1, 2, 3, 4]; // Example indices for a 2x2 crafting grid

        for (const index of craftingSlotIndices) {
            const slot = bot.inventory.slots[index];
            if (slot) {
                try {
                    await bot.moveSlotItem(index, bot.inventory.firstEmptyInventorySlot());
                    console.log(`Moved item from crafting slot ${index} to inventory`);
                } catch (err) {
                    console.log(`Error moving item from crafting slot ${index}:`, err);
                }
            }
        }
    }

    const craftItemNoTable = async (itemName, amount, maxRetries = 3) => {
        const mcData = minecraftData(bot.version);
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

        await clearCraftingSlots(bot);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await bot.craft(recipe, amount, null);
                console.log(`Successfully crafted ${itemName} ${amount} times, ${getItemCountInInventory(bot, itemName)}/${targets.expectedQuantityAfterCraft} items in inventory`);
                return true;
            } catch (err) {
                console.log(`Error crafting ${itemName} (Attempt ${attempt}/${maxRetries}):`, err);

                if (err.message && err.message.includes('Server rejected transaction')) {
                    const match = err.message.match(/slot (\d+)/);
                    if (match) {
                        const slotNumber = parseInt(match[1]);
                        if (slotNumber === 0) {
                            console.log(`Retrying click on slot ${slotNumber}...`);
                            try {
                                await bot.simpleClick.leftMouse(slotNumber);
                                console.log(`Successfully clicked slot ${slotNumber}`);
                                await new Promise(resolve => setTimeout(resolve, 500));
                                continue;
                            } catch (clickErr) {
                                console.log(`Error retrying click on slot ${slotNumber}:`, clickErr);
                            }
                        }
                    }
                }

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
