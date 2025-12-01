const mineflayer = require('mineflayer');
const { BotStateMachine } = require('mineflayer-statemachine');
import { buildStateMachineForPath } from '../behavior_generator/buildMachine';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';

let botOptions: any = { host: 'localhost', port: 25565, username: 'path_runner' };
if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

const bot = mineflayer.createBot(botOptions);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
bot.loadPlugin(require('mineflayer-tool').plugin);
import logger from '../utils/logger';

bot.once('spawn', () => {
  configurePrecisePathfinder(bot);
  
  const hardcodedPath = [
    { action: 'mine', what: 'spruce_log', targetItem: 'spruce_log', count: 3 },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'spruce_planks', perCraftCount: 4 } },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'crafting_table', perCraftCount: 1 } },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'spruce_planks', perCraftCount: 4 } },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'stick', perCraftCount: 4 } },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'spruce_planks', perCraftCount: 4 } },
    { action: 'craft', what: 'table', count: 1, result: { item: 'wooden_pickaxe', perCraftCount: 1 } }
  ];

  let sm: any = null;

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    if (message.trim() === 'go') {
      logger.info('PathRunner: building state machine for hardcoded path...');
      sm = buildStateMachineForPath(bot, hardcodedPath as any);
      logger.info('PathRunner: starting state machine');
      new BotStateMachine(bot, sm);
    }
  });
});


export {};
