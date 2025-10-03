const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine
} = require('mineflayer-statemachine')

const minecraftData = require('minecraft-data')

const { getItemCountInInventory } = require('../util')
const logger = require('../utils/logger')

const createCraftWithTableState = (bot, targets) => {
    const craftItemWithTable = async (itemName, additionalNeeded) => {
        const mcData = minecraftData(bot.version);
        const item = mcData.itemsByName[itemName];

        if (!item) {
            logger.error(`BehaviorCraftWithTable: Item ${itemName} not found`);
            return false;
        }

        let craftingTable = null;
        try {
            // Prefer placed position if provided (from craftTable behavior)
            if (targets && targets.placedPosition) {
                const maybe = bot.blockAt(targets.placedPosition, false)
                if (maybe && maybe.name === 'crafting_table') craftingTable = maybe
            }
        } catch (_) {}
        if (!craftingTable) {
            try {
                const list = bot.findBlocks({ matching: b => b.name === 'crafting_table', maxDistance: 4, count: 4 }) || []
                for (const p of list) {
                    const b = bot.blockAt(p, false)
                    if (b && b.name === 'crafting_table') { craftingTable = b; break }
                }
            } catch (_) {}
            if (!craftingTable) craftingTable = bot.findBlock({ matching: block => block.name === 'crafting_table', maxDistance: 4 });
        }

        if (!craftingTable) {
            logger.error(`BehaviorCraftWithTable: No crafting table within range`);
            return false;
        }

        logger.info(`BehaviorCraftWithTable: Searching for recipes for ${itemName} (id: ${item.id})`);
        const recipes = bot.recipesFor(item.id, null, 1, craftingTable);
        logger.info(`BehaviorCraftWithTable: Found ${recipes.length} recipes`);

        const recipe = recipes[0];

        if (!recipe) {
            logger.error(`BehaviorCraftWithTable: No recipe found for ${itemName}. Available recipes: ${recipes.length}`);
            return false;
        }

        const startingCount = getItemCountInInventory(bot, itemName);
        const targetCount = startingCount + additionalNeeded;
        let currentCount = startingCount;

        logger.info(`BehaviorCraftWithTable: Starting with ${startingCount} ${itemName}, need ${additionalNeeded} more (target: ${targetCount})`);

        const hasIngredients = recipe.delta.filter(item => item.count < 0)
            .every(item => {
                const requiredCount = Math.abs(item.count);
                const availableCount = getItemCountInInventory(bot, mcData.items[item.id].name);
                const hasEnough = availableCount >= requiredCount;

                if (!hasEnough) {
                    logger.warn(`BehaviorCraftWithTable: Missing ingredients. Need ${requiredCount} ${mcData.items[item.id].name} but only have ${availableCount}`);
                }

                return hasEnough;
            });

        if (!hasIngredients) {
            logger.error(`BehaviorCraftWithTable: Cannot craft ${itemName} - missing ingredients`);
            return false;
        }

        try {
            const remainingNeeded = targetCount - currentCount;
            const timesToCraft = Math.min(Math.ceil(remainingNeeded / recipe.result.count), Math.floor(64 / recipe.result.count));

            logger.info(`BehaviorCraftWithTable: Attempting to craft ${timesToCraft} times`);

            await bot.craft(recipe, timesToCraft, craftingTable);

            const newCount = getItemCountInInventory(bot, itemName);
            logger.info(`BehaviorCraftWithTable: Successfully crafted. Inventory now has ${newCount}/${targetCount} ${itemName} (started with ${startingCount})`);

            if (newCount === currentCount) {
                logger.error('BehaviorCraftWithTable: Crafting did not increase item count');
                return false;
            }

            return newCount >= targetCount;

        } catch (err) {
            logger.error(`BehaviorCraftWithTable: Error crafting ${itemName}:`, err);
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
                logger.error('BehaviorCraftWithTable: Error: No item name')
            }
            if (targets.amount == null) {
                logger.error('BehaviorCraftWithTable: Error: No amount')
            }
            logger.info('BehaviorCraftWithTable: enter -> exit')
        }
    })

    let waitForCraftStartTime
    let craftingDone = false
    let craftingOk = false
    const enterToWaitForCraft = new StateTransition({
        parent: enter,
        child: waitForCraft,
        name: 'BehaviorCraftWithTable: enter -> wait for craft',
        shouldTransition: () => targets.itemName != null && targets.amount != null,
        onTransition: () => {
            waitForCraftStartTime = Date.now()
            logger.info('BehaviorCraftWithTable: enter -> wait for craft')
            craftingDone = false
            craftingOk = false
            Promise.resolve()
                .then(() => craftItemWithTable(targets.itemName, targets.amount))
                .then(ok => { craftingOk = !!ok; craftingDone = true })
                .catch(err => { logger.error('BehaviorCraftWithTable: craft promise error', err); craftingOk = false; craftingDone = true })
        }
    })

    const waitForCraftToExit = new StateTransition({
        parent: waitForCraft,
        child: exit,
        name: 'BehaviorCraftWithTable: wait for craft -> exit',
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
                logger.info(`BehaviorCraftWithTable: wait for craft -> exit (complete ${have}/${targets.amount})`)
            } else if (timedOut) {
                logger.info(`BehaviorCraftWithTable: wait for craft -> exit (timeout ${have}/${targets.amount})`)
            } else {
                logger.info(`BehaviorCraftWithTable: wait for craft -> exit (craftingDone=${craftingDone}, ok=${craftingOk})`)
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


module.exports = createCraftWithTableState;


