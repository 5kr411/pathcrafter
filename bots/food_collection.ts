/**
 * Food Collection E2E Test Bot
 * 
 * Standalone bot for testing the food collection behaviors in isolation.
 * 
 * Usage:
 *   node food_collection.js [host] [port] [username]
 * 
 * Commands:
 *   food [points]    - Start full food collection with fallback (default: 40 points)
 *   food hunt        - Test hunting behavior only
 *   food bread [n]   - Test bread collection only (default: 3 bread)
 *   status           - Show current food status
 *   stop             - Stop current operation
 *   help             - Show available commands
 */

const mineflayer = require('mineflayer');
const { BotStateMachine } = require('mineflayer-statemachine');

import createGetFoodState from '../behaviors/behaviorGetFood';
import createHuntForFoodState from '../behaviors/behaviorHuntForFood';
import createCollectBreadState from '../behaviors/behaviorCollectBread';
import { captureAdaptiveSnapshot } from '../utils/adaptiveSnapshot';
import { getInventoryObject, getItemCountInInventory } from '../utils/inventory';
import {
  calculateFoodPointsInInventory,
  getFoodItemsFromInventory,
  hasHuntingWeapon,
  getBestHuntingWeapon,
  HUNTABLE_ANIMALS
} from '../utils/foodConfig';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';
import logger from '../utils/logger';

let botOptions: any = { host: 'localhost', port: 25565, username: 'food_bot' };
if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

console.log('Creating food collection test bot with options:', botOptions);

const bot = mineflayer.createBot(botOptions);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
bot.loadPlugin(require('mineflayer-pvp').plugin);
bot.loadPlugin(require('mineflayer-tool').plugin);

let currentStateMachine: any = null;
let isExecuting = false;

function safeChat(msg: string): void {
  try {
    if (bot && bot._client && !bot._client.ended) {
      bot.chat(msg);
    }
  } catch (_) {}
}

function showFoodStatus(): void {
  const inventory = getInventoryObject(bot);
  const foodPoints = calculateFoodPointsInInventory(inventory);
  const foodItems = getFoodItemsFromInventory(inventory);
  const hasWeapon = hasHuntingWeapon(inventory);
  const weapon = getBestHuntingWeapon(inventory);
  
  safeChat(`Food points: ${foodPoints}`);
  safeChat(`Has hunting weapon: ${hasWeapon}${weapon ? ` (${weapon})` : ''}`);
  
  // Show specific food items
  const bread = getItemCountInInventory(bot, 'bread');
  const cookedBeef = getItemCountInInventory(bot, 'cooked_beef');
  const rawBeef = getItemCountInInventory(bot, 'beef');
  
  safeChat(`Bread: ${bread}, Cooked beef: ${cookedBeef}, Raw beef: ${rawBeef}`);
  
  if (foodItems.length > 0) {
    const top5 = foodItems.slice(0, 5);
    const foodList = top5.map(f => `${f.name}x${f.count}`).join(', ');
    safeChat(`All food: ${foodList}`);
  }
  
  // Check for nearby resources
  const animalNames = new Set(HUNTABLE_ANIMALS.map(a => a.entity));
  const nearbyAnimals: string[] = [];
  
  for (const entity of Object.values(bot.entities || {}) as any[]) {
    if (!entity || !entity.position) continue;
    const name = (entity.name || '').toLowerCase();
    if (animalNames.has(name)) {
      nearbyAnimals.push(name);
    }
  }
  
  if (nearbyAnimals.length > 0) {
    const counts: Record<string, number> = {};
    for (const a of nearbyAnimals) {
      counts[a] = (counts[a] || 0) + 1;
    }
    const animalList = Object.entries(counts).map(([k, v]) => `${k}x${v}`).join(', ');
    safeChat(`Nearby animals: ${animalList}`);
  } else {
    safeChat('No huntable animals nearby');
  }
}

async function captureSnapshot(): Promise<any> {
  try {
    safeChat('Scanning surroundings...');
    const result = await captureAdaptiveSnapshot(bot, {
      radii: [32, 64, 96, 128],
      onProgress: (msg: string) => logger.debug(`FoodE2E: ${msg}`)
    });
    return result.snapshot;
  } catch (err: any) {
    logger.warn(`FoodE2E: snapshot failed - ${err?.message || err}`);
    safeChat('Scan failed, proceeding anyway');
    return null;
  }
}

async function startFullFoodCollection(targetPoints: number): Promise<void> {
  if (isExecuting) {
    safeChat('Already executing, please wait...');
    return;
  }
  
  isExecuting = true;
  const startPoints = calculateFoodPointsInInventory(getInventoryObject(bot));
  
  safeChat(`Starting food collection - current: ${startPoints}, target: ${targetPoints}`);
  logger.info(`FoodE2E: starting full collection - current=${startPoints}, target=${targetPoints}`);
  
  const worldSnapshot = await captureSnapshot();
  
  currentStateMachine = createGetFoodState(bot, {
    targetFoodPoints: targetPoints,
    minFoodThreshold: 10,
    worldSnapshot,
    onComplete: (success: boolean) => {
      const endPoints = calculateFoodPointsInInventory(getInventoryObject(bot));
      const gained = endPoints - startPoints;
      
      safeChat(`Food collection ${success ? 'complete' : 'finished'}! Gained ${gained} points (now ${endPoints})`);
      logger.info(`FoodE2E: complete - success=${success}, gained=${gained}, final=${endPoints}`);
      
      cleanup();
    }
  });
  
  new BotStateMachine(bot, currentStateMachine);
}

async function startHuntTest(): Promise<void> {
  if (isExecuting) {
    safeChat('Already executing, please wait...');
    return;
  }
  
  isExecuting = true;
  const startPoints = calculateFoodPointsInInventory(getInventoryObject(bot));
  
  safeChat(`Testing hunt behavior - current food: ${startPoints}`);
  logger.info(`FoodE2E: starting hunt test - current=${startPoints}`);
  
  currentStateMachine = createHuntForFoodState(bot, {
    targetFoodPoints: startPoints + 20,
    onComplete: (success: boolean, foodGained: number) => {
      const endPoints = calculateFoodPointsInInventory(getInventoryObject(bot));
      
      safeChat(`Hunt ${success ? 'complete' : 'failed'}! Gained ${foodGained} points (now ${endPoints})`);
      logger.info(`FoodE2E: hunt complete - success=${success}, gained=${foodGained}, final=${endPoints}`);
      
      cleanup();
    }
  });
  
  new BotStateMachine(bot, currentStateMachine);
}

async function startBreadTest(count: number): Promise<void> {
  if (isExecuting) {
    safeChat('Already executing, please wait...');
    return;
  }
  
  isExecuting = true;
  const startBread = getItemCountInInventory(bot, 'bread');
  
  safeChat(`Testing bread collection - current: ${startBread}, target: +${count}`);
  logger.info(`FoodE2E: starting bread test - current=${startBread}, target=${count}`);
  
  const worldSnapshot = await captureSnapshot();
  
  currentStateMachine = createCollectBreadState(bot, {
    targetBreadCount: count,
    worldSnapshot,
    onComplete: (success: boolean, collected: number) => {
      const endBread = getItemCountInInventory(bot, 'bread');
      
      safeChat(`Bread collection ${success ? 'complete' : 'failed'}! Collected ${collected} (now ${endBread})`);
      logger.info(`FoodE2E: bread complete - success=${success}, collected=${collected}, final=${endBread}`);
      
      cleanup();
    }
  });
  
  new BotStateMachine(bot, currentStateMachine);
}

function cleanup(): void {
  isExecuting = false;
  currentStateMachine = null;
}

function stopExecution(): void {
  if (!isExecuting) {
    safeChat('Nothing is running');
    return;
  }
  
  safeChat('Stopping...');
  
  if (currentStateMachine && typeof currentStateMachine.onStateExited === 'function') {
    try {
      currentStateMachine.onStateExited();
    } catch (_) {}
  }
  
  try {
    bot.clearControlStates();
  } catch (_) {}
  
  if (bot.pvp && bot.pvp.target) {
    try {
      bot.pvp.stop();
    } catch (_) {}
  }
  
  cleanup();
  safeChat('Stopped');
}

function showHelp(): void {
  safeChat('Commands:');
  safeChat('  food [points] - Full collection with fallback');
  safeChat('  food hunt - Test hunting only');
  safeChat('  food bread [n] - Test bread collection');
  safeChat('  status - Show food status');
  safeChat('  stop - Stop current operation');
}

bot.once('spawn', () => {
  console.log('Bot spawned successfully!');
  configurePrecisePathfinder(bot);
  
  safeChat('Food collection bot ready. Say "help" for commands');
  
  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    
    const parts = message.trim().toLowerCase().split(/\s+/);
    const command = parts[0];
    
    switch (command) {
      case 'food':
      case 'collect':
      case 'getfood': {
        const subCommand = parts[1];
        
        if (subCommand === 'hunt') {
          void startHuntTest();
        } else if (subCommand === 'bread') {
          const count = parseInt(parts[2]) || 3;
          void startBreadTest(count);
        } else {
          const targetPoints = parseInt(parts[1]) || 40;
          void startFullFoodCollection(targetPoints);
        }
        break;
      }
      
      case 'status':
      case 'info': {
        showFoodStatus();
        break;
      }
      
      case 'stop':
      case 'cancel': {
        stopExecution();
        break;
      }
      
      case 'help':
      case 'commands': {
        showHelp();
        break;
      }
    }
  });
  
  bot.on('death', () => {
    logger.info('FoodE2E: bot died');
    safeChat('I died!');
    stopExecution();
  });
});

bot.on('error', (err: Error) => console.error('Bot error:', err));
bot.on('end', () => {
  console.log('Bot disconnected');
  process.exit(0);
});

console.log('Waiting for spawn event...');

export {};
