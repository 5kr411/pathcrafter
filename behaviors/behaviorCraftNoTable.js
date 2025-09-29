const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine
} = require('mineflayer-statemachine')

const { getItemCountInInventory } = require('../util')
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

    const craftItemNoTable = async (itemName, additionalNeeded) => {
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

        const startingCount = getItemCountInInventory(bot, itemName);
        const targetCount = startingCount + additionalNeeded;
        let currentCount = startingCount;

        console.log(`BehaviorCraftNoTable: Starting with ${startingCount} ${itemName}, need ${additionalNeeded} more (target: ${targetCount})`);

        const hasIngredients = recipe.delta.filter(item => item.count < 0)
            .every(item => {
                const requiredCount = Math.abs(item.count);
                const availableCount = getItemCountInInventory(bot, mcData.items[item.id].name);
                const hasEnough = availableCount >= requiredCount;

                if (!hasEnough) {
                    console.log(`BehaviorCraftNoTable: Missing ingredients. Need ${requiredCount} ${mcData.items[item.id].name} but only have ${availableCount}`);
                }

                return hasEnough;
            });

        if (!hasIngredients) {
            console.log(`BehaviorCraftNoTable: Cannot craft ${itemName} - missing ingredients`);
            return false;
        }

        try {
            await clearCraftingSlots(bot);

            const remainingNeeded = targetCount - currentCount;
            const timesToCraft = Math.min(Math.ceil(remainingNeeded / recipe.result.count), Math.floor(64 / recipe.result.count));

            console.log(`BehaviorCraftNoTable: Attempting to craft ${timesToCraft} times`);

            await bot.craft(recipe, timesToCraft, null);

            const newCount = getItemCountInInventory(bot, itemName);
            console.log(`BehaviorCraftNoTable: Successfully crafted. Inventory now has ${newCount}/${targetCount} ${itemName} (started with ${startingCount})`);

            if (newCount === currentCount) {
                console.log('BehaviorCraftNoTable: Crafting did not increase item count');
                return false;
            }

            return newCount >= targetCount;

        } catch (err) {
            console.log(`BehaviorCraftNoTable: Error crafting ${itemName}:`, err);
            await clearCraftingSlots(bot);
            return false;
        }
    };

    const enterToExit = new StateTransition({
        parent: enter,
        child: exit,
        name: 'BehaviorCraftNoTable: enter -> exit',
        shouldTransition: () => targets.itemName == null || targets.amount == null,
        onTransition: () => {
            if (targets.itemName == null) {
                console.log('BehaviorCraftNoTable: Error: No item name')
            }
            if (targets.amount == null) {
                console.log('BehaviorCraftNoTable: Error: No amount')
            }
            console.log('BehaviorCraftNoTable: enter -> exit')
        }
    })

    let waitForCraftStartTime
    let craftingDone = false
    let craftingOk = false
    const enterToWaitForCraft = new StateTransition({
        parent: enter,
        child: waitForCraft,
        name: 'BehaviorCraftNoTable: enter -> wait for craft',
        shouldTransition: () => targets.itemName != null && targets.amount != null,
        onTransition: () => {
            waitForCraftStartTime = Date.now()
            console.log('BehaviorCraftNoTable: enter -> wait for craft')
            craftingDone = false
            craftingOk = false
            Promise.resolve()
                .then(() => craftItemNoTable(targets.itemName, targets.amount))
                .then(ok => { craftingOk = !!ok; craftingDone = true })
                .catch(err => { console.log('BehaviorCraftNoTable: craft promise error', err); craftingOk = false; craftingDone = true })
        }
    })

    const waitForCraftToExit = new StateTransition({
        parent: waitForCraft,
        child: exit,
        name: 'BehaviorCraftNoTable: wait for craft -> exit',
        shouldTransition: () => {
            const have = getItemCountInInventory(bot, targets.itemName)
            if (have >= targets.amount) return true
            const timedOut = Date.now() - waitForCraftStartTime > 20000
            if (timedOut) return true
            return craftingDone
        },
        onTransition: () => {
            const have = getItemCountInInventory(bot, targets.itemName)
            const timedOut = Date.now() - waitForCraftStartTime > 20000
            if (have >= targets.amount) {
                console.log(`BehaviorCraftNoTable: wait for craft -> exit (complete ${have}/${targets.amount})`)
            } else if (timedOut) {
                console.log(`BehaviorCraftNoTable: wait for craft -> exit (timeout ${have}/${targets.amount})`)
            } else {
                console.log(`BehaviorCraftNoTable: wait for craft -> exit (craftingDone=${craftingDone}, ok=${craftingOk})`)
            }
        }
    })

    const transitions = [
        enterToExit,
        enterToWaitForCraft,
        waitForCraftToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createCraftNoTableState;


