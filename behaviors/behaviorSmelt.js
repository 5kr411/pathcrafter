const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BehaviorEquipItem
} = require('mineflayer-statemachine')
const minecraftData = require('minecraft-data')
const createPlaceNearState = require('./behaviorPlaceNear')
const createBreakAtPositionState = require('./behaviorBreakAtPosition')

function createSmeltState(bot, targets) {
    const enter = new BehaviorIdle()
    const findFurnace = new BehaviorIdle()
    const equipFurnace = new BehaviorEquipItem(bot, { item: null })
    const placeFurnaceTargets = { item: null }
    let placeFurnace
    try { placeFurnace = createPlaceNearState(bot, placeFurnaceTargets) } catch (_) { placeFurnace = { isFinished: () => true } }
    const smeltRun = new BehaviorIdle()
    const breakTargets = { position: null }
    const breakFurnace = createBreakAtPositionState(bot, breakTargets)
    const exit = new BehaviorIdle()

    function getMc() { try { return minecraftData(bot.version) } catch (_) { return minecraftData('1.20.1') } }
    function getItemCount(name) {
        try {
            let c = 0; const items = bot.inventory?.items() || []
            for (const it of items) if (it && it.name === name) c += it.count
            return c
        } catch (_) { return 0 }
    }
    function findNearbyFurnace(maxDistance = 6) {
        try {
            const ids = ['furnace', 'lit_furnace'].filter(n => bot.registry.blocksByName[n] !== undefined).map(n => bot.registry.blocksByName[n].id)
            return bot.findBlock({ matching: ids, maxDistance })
        } catch (_) { return null }
    }

    let wantItem, wantCount, inputItem, fuelItem
    const initToFind = new StateTransition({
        name: 'Smelt: enter -> find', parent: enter, child: findFurnace,
        shouldTransition: () => true,
        onTransition: () => {
            wantItem = targets.itemName; wantCount = Number(targets.amount || 1)
            inputItem = targets.inputName; fuelItem = targets.fuelName || 'coal'
        }
    })

    let foundFurnace = null
    let placedByUs = false
    const findToEquip = new StateTransition({
        name: 'Smelt: find -> equip furnace', parent: findFurnace, child: equipFurnace,
        shouldTransition: () => {
            foundFurnace = findNearbyFurnace(6)
            if (foundFurnace) return false
            try { equipFurnace.targets.item = bot.inventory?.items?.().find(it => it && it.name === 'furnace') || null } catch (_) {}
            return !!equipFurnace.targets.item
        },
        onTransition: () => { placedByUs = true }
    })

    const findToSmelt = new StateTransition({
        name: 'Smelt: find -> run (already placed)', parent: findFurnace, child: smeltRun,
        shouldTransition: () => {
            foundFurnace = findNearbyFurnace(6)
            return !!foundFurnace
        },
        onTransition: () => { placedByUs = false }
    })

    const equipToPlace = new StateTransition({
        name: 'Smelt: equip -> place', parent: equipFurnace, child: placeFurnace,
        shouldTransition: () => (typeof equipFurnace.isFinished === 'function' ? equipFurnace.isFinished() : true) && !!equipFurnace.targets.item,
        onTransition: () => { placeFurnaceTargets.item = equipFurnace.targets.item }
    })

    const placeToSmelt = new StateTransition({
        name: 'Smelt: place -> run', parent: placeFurnace, child: smeltRun,
        shouldTransition: () => typeof placeFurnace.isFinished === 'function' ? placeFurnace.isFinished() : true,
        onTransition: () => {
            try {
                if (placeFurnaceTargets && placeFurnaceTargets.placedPosition) {
                    breakTargets.position = placeFurnaceTargets.placedPosition.clone()
                }
            } catch (_) {}
        }
    })

    let startedAt = 0
    let smeltDone = false
    let smeltSucceeded = false
    smeltRun.onStateEntered = async () => {
        startedAt = Date.now()
        try {
            const mc = getMc()
            let furnaceBlock = findNearbyFurnace(6)
            if (!furnaceBlock) return
            const furnace = await bot.openFurnace(furnaceBlock)
            const outTarget = getItemCount(wantItem) + Math.max(1, wantCount)
            function idOf(name) { return mc.itemsByName[name]?.id }
            function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
            let lastTake = Date.now()
            while (getItemCount(wantItem) < outTarget && Date.now() - startedAt < 60000) {
                try {
                    if (inputItem && getItemCount(inputItem) > 0 && !furnace.inputItem()) {
                        await furnace.putInput(idOf(inputItem), null, Math.min(getItemCount(inputItem), outTarget - getItemCount(wantItem)))
                    }
                } catch (_) {}
                try {
                    if (fuelItem && getItemCount(fuelItem) > 0 && !furnace.fuelItem()) {
                        await furnace.putFuel(idOf(fuelItem), null, 1)
                    }
                } catch (_) {}
                try {
                    if (furnace.outputItem()) {
                        await furnace.takeOutput()
                        lastTake = Date.now()
                    }
                } catch (_) {}
                await sleep(500)
            }
            try { furnace.close() } catch (_) {}
            smeltSucceeded = getItemCount(wantItem) >= outTarget
        } catch (err) {
            console.log('BehaviorSmelt: error during smelt run', err)
        } finally { smeltDone = true }
    }

    const runToBreak = new StateTransition({
        name: 'Smelt: run -> break', parent: smeltRun, child: breakFurnace,
        shouldTransition: () => smeltDone && placedByUs,
        onTransition: () => {}
    })

    const breakToExit = new StateTransition({
        name: 'Smelt: break -> exit', parent: breakFurnace, child: exit,
        shouldTransition: () => typeof breakFurnace.isFinished === 'function' ? breakFurnace.isFinished() : true,
        onTransition: () => {}
    })

    const runToExit = new StateTransition({
        name: 'Smelt: run -> exit (no break)', parent: smeltRun, child: exit,
        shouldTransition: () => smeltDone && !placedByUs,
        onTransition: () => {}
    })

    return new NestedStateMachine([
        initToFind,
        findToSmelt,
        findToEquip,
        equipToPlace,
        placeToSmelt,
        runToBreak,
        breakToExit,
        runToExit
    ], enter, exit)
}

module.exports = createSmeltState


