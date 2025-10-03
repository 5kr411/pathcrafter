const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
} = require('mineflayer-statemachine')

const createCraftNoTableIfNeeded = require('./behaviorCraftNoTableIfNeeded')
const createCraftWithTableIfNeeded = require('./behaviorCraftWithTableIfNeeded')
const logger = require('../utils/logger')

function createCraftWoodenToolsIfNeededState(bot, targets) {
    const enter = new BehaviorIdle()

    const craftPlanksIfNeededState = createCraftNoTableIfNeeded(bot, targets)

    const craftSticksIfNeededState = createCraftNoTableIfNeeded(bot, targets)

    const craftWoodenPickaxeIfNeededState = createCraftWithTableIfNeeded(bot, targets)

    const craftWoodenAxeIfNeededState = createCraftWithTableIfNeeded(bot, targets)

    const exit = new BehaviorIdle()

    const enterToCraftPlanks = new StateTransition({
        parent: enter,
        child: craftPlanksIfNeededState,
        name: 'BehaviorCraftWoodenToolsIfNeeded: enter -> craft planks',
        shouldTransition: () => true,
        onTransition: () => {
            targets.itemName = 'oak_planks'
            targets.amount = 8
            logger.info('BehaviorCraftWoodenToolsIfNeeded: enter -> craft planks')
        }
    })

    const craftPlanksToCraftSticks = new StateTransition({
        parent: craftPlanksIfNeededState,
        child: craftSticksIfNeededState,
        name: 'BehaviorCraftWoodenToolsIfNeeded: craft planks -> craft sticks',
        shouldTransition: () => craftPlanksIfNeededState.isFinished(),
        onTransition: () => {
            targets.itemName = 'stick'
            targets.amount = 4
            logger.info('BehaviorCraftWoodenToolsIfNeeded: craft planks -> craft sticks')
        }
    })

    const craftSticksToCraftWoodenPickaxe = new StateTransition({
        parent: craftSticksIfNeededState,
        child: craftWoodenPickaxeIfNeededState,
        name: 'BehaviorCraftWoodenToolsIfNeeded: craft sticks -> craft wooden pickaxe',
        shouldTransition: () => craftSticksIfNeededState.isFinished(),
        onTransition: () => {
            targets.itemName = 'wooden_pickaxe'
            targets.amount = 1
            logger.info('BehaviorCraftWoodenToolsIfNeeded: craft sticks -> craft wooden pickaxe')
        }
    })

    const craftWoodenPickaxeToCraftWoodenAxe = new StateTransition({
        parent: craftWoodenPickaxeIfNeededState,
        child: craftWoodenAxeIfNeededState,
        name: 'BehaviorCraftWoodenToolsIfNeeded: craft wooden pickaxe -> craft wooden axe',
        shouldTransition: () => craftWoodenPickaxeIfNeededState.isFinished(),
        onTransition: () => {
            targets.itemName = 'wooden_axe'
            targets.amount = 1
            logger.info('BehaviorCraftWoodenToolsIfNeeded: craft wooden pickaxe -> craft wooden axe')
        }
    })

    const craftWoodenAxeToExit = new StateTransition({
        parent: craftWoodenAxeIfNeededState,
        child: exit,
        name: 'BehaviorCraftWoodenToolsIfNeeded: craft wooden axe -> exit',
        shouldTransition: () => craftWoodenAxeIfNeededState.isFinished(),
        onTransition: () => {
            logger.info('BehaviorCraftWoodenToolsIfNeeded: craft wooden axe -> exit')
        }
    })

    const transitions = [
        enterToCraftPlanks,
        craftPlanksToCraftSticks,
        craftSticksToCraftWoodenPickaxe,
        craftWoodenPickaxeToCraftWoodenAxe,
        craftWoodenAxeToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createCraftWoodenToolsIfNeededState


