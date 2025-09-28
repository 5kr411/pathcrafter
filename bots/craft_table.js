const mineflayer = require('mineflayer')

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  BotStateMachine,
} = require('mineflayer-statemachine')
const { BehaviorEquipItem } = require('mineflayer-statemachine')

const createPlaceNearState = require('../behaviors/behaviorPlaceNear')
const createCraftWithTableState = require('../behaviors/behaviorCraftWithTable')
const createBreakAtPositionState = require('../behaviors/behaviorBreakAtPosition')

let botOptions = {
  host: 'localhost',
  port: 25565,
  username: 'craft_table_bot'
}

if (process.argv.length >= 4) {
  botOptions.host = process.argv[2]
  botOptions.port = parseInt(process.argv[3])
  if (process.argv[4]) botOptions.username = process.argv[4]
  if (process.argv[5]) botOptions.password = process.argv[5]
}

const bot = mineflayer.createBot(botOptions)
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder)

bot.once('spawn', () => {
  const targets = {}

  const enter = new BehaviorIdle()
  const placeTargets = { item: { name: 'crafting_table' } }
  const place = createPlaceNearState(bot, placeTargets)

  const craftTargets = {}
  const craft = createCraftWithTableState(bot, craftTargets)

  const breakTargets = {}
  const breakBlock = createBreakAtPositionState(bot, breakTargets)

  const exit = new BehaviorIdle()

  const equipTargets = {}
  const equip = new BehaviorEquipItem(bot, equipTargets)

  const startTransition = new StateTransition({
    name: 'craft-table: enter -> equip',
    parent: enter,
    child: equip,
    shouldTransition: () => false,
    onTransition: () => {
      if (!craftTargets.itemName) craftTargets.itemName = 'wooden_pickaxe'
      if (!craftTargets.amount) craftTargets.amount = 1
      const tableItem = bot.inventory.items().find(it => it.name === 'crafting_table')
      if (tableItem) {
        placeTargets.item = tableItem
        equipTargets.item = tableItem
      } else {
        console.log('craft-table: no crafting_table in inventory to place')
      }
      bot.chat(`Starting craft at table: ${craftTargets.amount} ${craftTargets.itemName}`)
    }
  })

  const equipToPlace = new StateTransition({
    name: 'craft-table: equip -> place',
    parent: equip,
    child: place,
    shouldTransition: () => true
  })

  const placeToCraft = new StateTransition({
    name: 'craft-table: place -> craft',
    parent: place,
    child: craft,
    shouldTransition: () => place.isFinished && place.isFinished(),
    onTransition: () => {
      if (placeTargets && placeTargets.placedPosition) {
        breakTargets.position = placeTargets.placedPosition.clone()
      }
    }
  })

  const craftToBreak = new StateTransition({
    name: 'craft-table: craft -> break',
    parent: craft,
    child: breakBlock,
    shouldTransition: () => craft.isFinished && craft.isFinished(),
  })

  const breakToExit = new StateTransition({
    name: 'craft-table: break -> exit',
    parent: breakBlock,
    child: exit,
    shouldTransition: () => breakBlock.isFinished && breakBlock.isFinished(),
    onTransition: () => bot.chat('Craft at table complete (and table recovered)')
  })

  const exitToEnter = new StateTransition({
    name: 'craft-table: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true
  })

  const transitions = [startTransition, equipToPlace, placeToCraft, craftToBreak, breakToExit, exitToEnter]
  const root = new NestedStateMachine(transitions, enter)
  root.name = 'craft_table_root'

  // Wire chat control: wait for "go"
  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    const parts = message.trim().split(/\s+/)
    if (parts[0] === 'craft') {
      if (parts[1]) craftTargets.itemName = parts[1]
      if (parts[2]) {
        const n = parseInt(parts[2])
        if (!Number.isNaN(n)) craftTargets.amount = n
      }
      setTimeout(() => startTransition.trigger(), 0)
    }
  })

  new BotStateMachine(bot, root)
})


