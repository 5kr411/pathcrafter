const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BehaviorEquipItem
} = require('mineflayer-statemachine')
const minecraftData = require('minecraft-data')
const { getSmeltsPerUnitForFuel } = require('../utils/smeltingConfig')
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
            console.log(`BehaviorSmelt: enter -> find (want ${wantCount} ${wantItem}, input=${inputItem}, fuel=${fuelItem})`)
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
        onTransition: () => { placedByUs = true; console.log('BehaviorSmelt: find -> equip furnace (no furnace nearby)') }
    })

    const findToSmelt = new StateTransition({
        name: 'Smelt: find -> run (already placed)', parent: findFurnace, child: smeltRun,
        shouldTransition: () => {
            foundFurnace = findNearbyFurnace(6)
            return !!foundFurnace
        },
        onTransition: () => { placedByUs = false; console.log('BehaviorSmelt: find -> run (using existing furnace)') }
    })

    const equipToPlace = new StateTransition({
        name: 'Smelt: equip -> place', parent: equipFurnace, child: placeFurnace,
        shouldTransition: () => (typeof equipFurnace.isFinished === 'function' ? equipFurnace.isFinished() : true) && !!equipFurnace.targets.item,
        onTransition: () => { placeFurnaceTargets.item = equipFurnace.targets.item; console.log('BehaviorSmelt: equip -> place furnace') }
    })

    const placeToSmelt = new StateTransition({
        name: 'Smelt: place -> run', parent: placeFurnace, child: smeltRun,
        shouldTransition: () => typeof placeFurnace.isFinished === 'function' ? placeFurnace.isFinished() : true,
        onTransition: () => {
            try {
                if (placeFurnaceTargets && placeFurnaceTargets.placedPosition) {
                    breakTargets.position = placeFurnaceTargets.placedPosition.clone()
                    console.log('BehaviorSmelt: place -> run (placed furnace at)', breakTargets.position)
                }
            } catch (_) {}
        }
    })

    let startedAt = 0
    let smeltDone = false
    let smeltSucceeded = false
    let breakRecommended = false
    smeltRun.onStateEntered = async () => {
        startedAt = Date.now()
        try {
            const mc = getMc()
            let furnaceBlock = findNearbyFurnace(6)
            if (!furnaceBlock) return
            const furnace = await bot.openFurnace(furnaceBlock)
            const outTarget = getItemCount(wantItem) + Math.max(1, wantCount)
            console.log(`BehaviorSmelt: run start (have ${getItemCount(wantItem)} ${wantItem}, target ${outTarget})`)
            function idOf(name) { return mc.itemsByName[name]?.id }
            function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
            let lastTake = Date.now()
            let lastProgress = 0
            let prevOut = getItemCount(wantItem)
            let lastActivity = Date.now()
            let lastFuelPut = 0
            const STALL_TIMEOUT_MS = 20000
            // Track fuel locally to avoid duplicate top-ups due to delayed window updates
            let localFuelCount = furnace.fuelItem() ? (furnace.fuelItem().count || 0) : 0
            while (getItemCount(wantItem) < outTarget && Date.now() - lastActivity < STALL_TIMEOUT_MS) {
                let acted = false
                try {
                    if (inputItem && getItemCount(inputItem) > 0 && !furnace.inputItem()) {
                        const toPut = Math.min(getItemCount(inputItem), Math.max(1, outTarget - getItemCount(wantItem)))
                        await furnace.putInput(idOf(inputItem), null, toPut)
                        console.log(`BehaviorSmelt: put input x${toPut} ${inputItem}`)
                        acted = true
                    }
                } catch (_) {}
                try {
                    if (fuelItem && getItemCount(fuelItem) > 0) {
                        const perUnit = Math.max(1, getSmeltsPerUnitForFuel(fuelItem) || 0)
                        const haveOut = getItemCount(wantItem)
                        const remaining = Math.max(0, outTarget - haveOut)
                        const desiredUnits = Math.ceil(remaining / perUnit)
                        // Sync local fuel count from furnace when available
                        const fuelSlot = furnace.fuelItem()
                        const currentUnits = fuelSlot ? (fuelSlot.count || 0) : localFuelCount
                        localFuelCount = currentUnits
                        const available = getItemCount(fuelItem)
                        const topUp = Math.max(0, Math.min(available, desiredUnits - currentUnits))
                        const now = Date.now()
                        if (topUp > 0 && (now - lastFuelPut > 800)) {
                            await furnace.putFuel(idOf(fuelItem), null, topUp)
                            localFuelCount += topUp
                            lastFuelPut = now
                            console.log(`BehaviorSmelt: put fuel x${topUp} ${fuelItem} (perUnit=${perUnit})`)
                            acted = true
                        }
                    }
                } catch (_) {}
                try {
                    if (furnace.outputItem()) {
                        await furnace.takeOutput()
                        lastTake = Date.now()
                        console.log(`BehaviorSmelt: took output (now have ${getItemCount(wantItem)}/${outTarget})`)
                        acted = true
                    }
                } catch (_) {}
                const prog = Number.isFinite(furnace.progress) ? furnace.progress : 0
                const curOut = getItemCount(wantItem)
                if (curOut > prevOut) { lastActivity = Date.now(); prevOut = curOut }
                if (acted || prog > lastProgress || furnace.inputItem() || furnace.outputItem()) {
                    lastActivity = Date.now()
                }
                lastProgress = prog
                await sleep(400)
            }
            smeltSucceeded = getItemCount(wantItem) >= outTarget
            const preIn = furnace.inputItem()
            const preOut = furnace.outputItem()
            const preFuel = furnace.fuelItem()
            const noInputInInv = !inputItem || getItemCount(inputItem) === 0
            const noFuelInInv = !fuelItem || getItemCount(fuelItem) === 0
            const furnaceIdle = !preIn && !preOut
            // Break if: target reached, or we have no input left, or furnace is idle and we have no fuel left
            breakRecommended = placedByUs && (smeltSucceeded || noInputInInv || (furnaceIdle && noFuelInInv))
            try { furnace.close() } catch (_) {}
            const stalled = !smeltSucceeded
            console.log(`BehaviorSmelt: run end (success=${smeltSucceeded}, stalled=${stalled}, have ${getItemCount(wantItem)}/${outTarget})`)
        } catch (err) {
            console.log('BehaviorSmelt: error during smelt run', err)
            // Break even on error if we placed the furnace
            breakRecommended = placedByUs || breakRecommended
        } finally { smeltDone = true }
    }

    const runToBreak = new StateTransition({
        name: 'Smelt: run -> break', parent: smeltRun, child: breakFurnace,
        shouldTransition: () => smeltDone && breakRecommended,
        onTransition: () => { console.log('BehaviorSmelt: run -> break (we placed furnace)') }
    })

    const breakToExit = new StateTransition({
        name: 'Smelt: break -> exit', parent: breakFurnace, child: exit,
        shouldTransition: () => typeof breakFurnace.isFinished === 'function' ? breakFurnace.isFinished() : true,
        onTransition: () => { console.log('BehaviorSmelt: break -> exit') }
    })

    const runToExit = new StateTransition({
        name: 'Smelt: run -> exit (no break)', parent: smeltRun, child: exit,
        shouldTransition: () => smeltDone && !breakRecommended,
        onTransition: () => { console.log('BehaviorSmelt: run -> exit (did not place furnace)') }
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


