const mineflayer = require('mineflayer');
const { BotStateMachine } = require('mineflayer-statemachine');
import { buildStateMachineForPath } from '../behavior_generator/buildMachine';
const minecraftData = require('minecraft-data');
import analyzeRecipes from '../recipeAnalyzer';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';

let botOptions: any = { host: 'localhost', port: 25565, username: 'smelt_only' };
if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

const bot = mineflayer.createBot(botOptions);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);

bot.once('spawn', () => {
  configurePrecisePathfinder(bot);
  
  bot.chat('smelt_only ready');
  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    const m = message.trim().split(/\s+/);
    if (m[0] !== 'smelt') return;
    const item = m[1] || 'iron_ingot';
    const count = Number.parseInt(m[2] || '1');
    const mc = minecraftData(bot.version || '1.20.1');
    const inventory: Record<string, number> = {};
    try {
      (bot.inventory?.items() || []).forEach((it: any) => {
        inventory[it.name] = (inventory[it.name] || 0) + it.count;
      });
    } catch (_) {}
    const tree = analyzeRecipes(mc, item, count, { log: false, inventory });
    // choose first action path containing a smelt step to requested item
    const { enumerateActionPathsGenerator } = analyzeRecipes._internals;
    let chosen: any = null;
    for (const p of enumerateActionPathsGenerator(tree, { inventory })) {
      if (p.some((s: any) => s.action === 'smelt' && s.result?.item === item)) {
        chosen = p;
        break;
      }
    }
    if (!chosen) {
      bot.chat('no smelt path found');
      return;
    }
    const sm = buildStateMachineForPath(bot, chosen, () => bot.chat('smelt plan complete'));
    new BotStateMachine(bot, sm);
  });
});


export {};
