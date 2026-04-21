const mineflayer = require('mineflayer');

import { getConfig } from './collector/config';
import { WorkerManager } from './collector/worker_manager';
import { CommandHandler } from './collector/command_handler';
import { ReactiveBehaviorRegistry } from './collector/reactive_behavior_registry';
import { hostileMobBehavior } from './collector/reactive_behaviors/hostile_mob_behavior';
import { shieldDefenseBehavior } from './collector/reactive_behaviors/shield_defense_behavior';
import { hostileFleeBehavior } from './collector/reactive_behaviors/hostile_flee_behavior';
import { waterEscapeBehavior } from './collector/reactive_behaviors/water_escape_behavior';
import { armorUpgradeBehavior } from './collector/reactive_behaviors/armor_upgrade_behavior';
import { createFoodEatingBehavior } from './collector/reactive_behaviors/food_eating_behavior';
import { createDroppedFoodPickupBehavior } from './collector/reactive_behaviors/dropped_food_pickup_behavior';
import { createOpportunisticFoodHuntBehavior } from './collector/reactive_behaviors/opportunistic_food_hunt_behavior';
import { createFoodCollectionBehavior } from './collector/reactive_behaviors/food_collection_behavior';
import { createFoodSmeltingBehavior } from './collector/reactive_behaviors/food_smelting_behavior';
import { createInventoryManagementBehavior } from './collector/reactive_behaviors/inventory_management_behavior';
import { createToolReplacementBehavior } from './collector/reactive_behaviors/tool_replacement_behavior';
import { CollectorControlStack } from './collector/control_stack';
import { setSafeFindRepeatThreshold, setLiquidAvoidanceDistance } from '../utils/config';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';
import { installExplosionSanitizer } from '../utils/explosionSanitizer';
import { installPacketErrorSuppressor } from '../utils/packetErrorSuppressor';
import { createRateLimitedChat } from '../utils/rateLimitedChat';
import logger from '../utils/logger';
import { parseCliTargets } from '../utils/cli';
import { resolveRunDir } from '../utils/runDir';

const config = getConfig();

if (!process.env.LOG_LEVEL) {
  logger.setLevel(config.logLevel);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
let botOptions: any = { host: 'localhost', port: 25565, username: 'collector' };
if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5] && !process.argv[5].startsWith('--')) botOptions.password = process.argv[5];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
const bot: any = mineflayer.createBot(botOptions);
// mineflayer-pathfinder leaks digging listeners on resetPath — raise limit to avoid noisy warnings
bot.setMaxListeners(25);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
bot.loadPlugin(require('mineflayer-pvp').plugin);
bot.loadPlugin(require('mineflayer-tool').plugin);

bot.once('login', () => {
  installExplosionSanitizer(bot);
  installPacketErrorSuppressor(bot);

  // Keepalive monitoring — track round-trip to detect silent drops
  let lastKeepaliveReceived = Date.now();
  let keepaliveCount = 0;

  bot._client.on('keep_alive', () => {
    const now = Date.now();
    const gap = now - lastKeepaliveReceived;
    lastKeepaliveReceived = now;
    keepaliveCount++;
    if (gap > 25000) {
      logger.warn(`Keepalive: received after ${gap}ms gap (expected ~15s), count=${keepaliveCount}`);
    } else {
      logger.debug(`Keepalive: received, gap=${gap}ms, count=${keepaliveCount}`);
    }

    // Check if the serializer can actually write the response
    const writable = bot._client.serializer?.writable;
    if (!writable) {
      logger.error(`Keepalive: serializer NOT writable — response will be silently dropped! count=${keepaliveCount}`);
    }

  });
});

bot.once('spawn', () => {
  configurePrecisePathfinder(bot);
  
  if (Number.isFinite(config.safeFindRepeatThreshold)) {
    setSafeFindRepeatThreshold(Math.max(1, Math.floor(config.safeFindRepeatThreshold)));
  }

  if (Number.isFinite(config.liquidAvoidanceDistance)) {
    setLiquidAvoidanceDistance(Math.max(0, Math.floor(config.liquidAvoidanceDistance)));
  }

  const safeChat = createRateLimitedChat(bot);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
  (bot as any).safeChat = safeChat;

  bot.on('kicked', (reason: string, loggedIn: boolean) => {
    logger.info(`Collector: kicked reason=${JSON.stringify(reason)} loggedIn=${loggedIn}`);
  });
  bot.on('end', (reason?: string) => {
    const endReason = reason ?? bot._client?._endReason ?? 'unknown';
    const ended = !!bot._client?.ended;
    const state = bot._client?.state;
    const socketWritable = !!bot._client?.socket?.writable;
    const serializerWritable = !!bot._client?.serializer?.writable;
    logger.info(`Collector: connection ended reason=${JSON.stringify(endReason)} ended=${ended} state=${state} sockWritable=${socketWritable} serWritable=${serializerWritable}`);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
  bot.on('error', (err: any) => {
    const code = err && err.code ? err.code : '';
    const msg = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : '';
    logger.info(`Collector: bot error code=${code} msg=${msg} stack=${stack}`);
  });

  // Surface low-level client errors separately — these are normally only routed through bot.on('error')
  // which mineflayer-loader installs, but catching at the client level gives us earlier signal.
  if (bot._client && typeof bot._client.on === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
    bot._client.on('error', (err: any) => {
      const code = err && err.code ? err.code : '';
      const msg = err && err.message ? err.message : String(err);
      logger.info(`Collector: _client error code=${code} msg=${msg}`);
    });
  }

  // Intercept client.end() so we can see WHO (what code path) is closing the socket and WHY.
  // This preserves original behavior — we just log before delegating.
  if (bot._client && typeof bot._client.end === 'function' && !bot._client._endWrapped) {
    const origEnd = bot._client.end.bind(bot._client);
    bot._client._endWrapped = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
    bot._client.end = function(reason?: any, ...rest: any[]) {
      const stack = new Error().stack?.split('\n').slice(1, 6).join(' | ');
      logger.info(`Collector: _client.end called reason=${JSON.stringify(reason)} stack=${stack}`);
      return origEnd(reason, ...rest);
    };
  }

  // Node-level uncaught rejection / exception — if anything in our pipeline throws asynchronously
  // and isn't caught, this is where it'll show up.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
  process.on('unhandledRejection', (reason: any) => {
    const msg = reason && reason.message ? reason.message : String(reason);
    const stack = reason && reason.stack ? reason.stack.split('\n').slice(0, 6).join(' | ') : '';
    logger.info(`Collector: unhandledRejection msg=${msg} stack=${stack}`);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
  process.on('uncaughtException', (err: any) => {
    const msg = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? err.stack.split('\n').slice(0, 6).join(' | ') : '';
    logger.info(`Collector: uncaughtException msg=${msg} stack=${stack}`);
  });

  // Initialize file logging
  const runDir = resolveRunDir();
  logger.initFileLogging(runDir, botOptions.username);

  const sp = bot.entity.position;
  logger.milestone(`bot ready — spawned at (${sp.x.toFixed(1)}, ${sp.y.toFixed(1)}, ${sp.z.toFixed(1)})`);
  safeChat('collector ready');

  const workerManager = new WorkerManager(
    () => {
      // Planning handlers are passed per request; ignore fallback results.
    },
    () => {}
  );

  const reactiveBehaviorRegistry = new ReactiveBehaviorRegistry();

  // Build per-bot reactive-behavior instances. Each factory owns its own
  // state (cooldowns, config, log-throttle timers) — no module singletons.
  const foodCollection = createFoodCollectionBehavior({
    config: { triggerFoodPoints: 10, targetFoodPoints: 20 }
  });
  const foodEating = createFoodEatingBehavior();
  const droppedFoodPickup = createDroppedFoodPickupBehavior({ foodCollection });
  const opportunisticFoodHunt = createOpportunisticFoodHuntBehavior({ foodCollection });
  const foodSmelting = createFoodSmeltingBehavior({ foodCollection });
  const inventoryManagement = createInventoryManagementBehavior();

  // Attach the inventory-management handle to the bot so utility call
  // sites (e.g. ensureInventoryRoom) can reach it without a module import.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  (bot as any).__reactiveBehaviors = { inventoryManagement };

  reactiveBehaviorRegistry.register(shieldDefenseBehavior);
  reactiveBehaviorRegistry.register(hostileFleeBehavior);
  reactiveBehaviorRegistry.register(waterEscapeBehavior);
  reactiveBehaviorRegistry.register(hostileMobBehavior);
  reactiveBehaviorRegistry.register(armorUpgradeBehavior);
  reactiveBehaviorRegistry.register(foodCollection.behavior);
  reactiveBehaviorRegistry.register(foodEating.behavior);
  reactiveBehaviorRegistry.register(droppedFoodPickup.behavior);
  reactiveBehaviorRegistry.register(opportunisticFoodHunt.behavior);
  reactiveBehaviorRegistry.register(foodSmelting.behavior);
  reactiveBehaviorRegistry.register(inventoryManagement.behavior);

  const controlStack = new CollectorControlStack(
    bot,
    workerManager,
    safeChat,
    {
      snapshotRadii: config.snapshotRadii,
      snapshotYHalf: config.snapshotYHalf,
      pruneWithWorld: config.pruneWithWorld,
      combineSimilarNodes: config.combineSimilarNodes,
      perGenerator: config.perGenerator,
      toolDurabilityThreshold: config.toolDurabilityThreshold
    },
    reactiveBehaviorRegistry
  );
  controlStack.start();
  const executor = controlStack.targetLayer;

  reactiveBehaviorRegistry.register(createToolReplacementBehavior({
    executor: controlStack.toolLayer,
    toolsBeingReplaced: controlStack.toolsBeingReplaced,
    durabilityThreshold: config.toolDurabilityThreshold
  }));

  inventoryManagement.setConfig({
    getTargets: () => executor.getTargets()
  });

  let lastDeathMessage: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
  bot.on('message', (jsonMsg: any) => {
    const text = jsonMsg.toString?.() || '';
    if (text.includes(bot.username)) {
      lastDeathMessage = text;
    }
  });

  bot.on('death', () => {
    const food = bot.food ?? '?';
    const health = bot.health ?? '?';
    const pos = bot.entity?.position;
    const posStr = pos ? `(${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})` : '?';
    const cause = lastDeathMessage || 'unknown';
    logger.info(`Collector: bot died at ${posStr}, health=${health}, food=${food}, cause="${cause}" — resetting and retrying all targets`);
    lastDeathMessage = null;
    // Reset food cooldown: respawn restores hunger to 20, so any prior "food is scarce" cooldown
    // is stale. Without this, a bot that died during its cooldown keeps the cooldown post-respawn
    // and may starve again before it can retry food collection.
    foodCollection.resetCooldown();
    if (executor.isRunning() || executor.getTargets().length > 0) {
      executor.resetAndRestart();
    }
  });

  bot.on('end', () => {
    workerManager.terminate();
    controlStack.stop();
    logger.close();
  });

  const commandHandler = new CommandHandler(bot, executor, safeChat);

  bot.on('chat', (username: string, message: string) => {
    commandHandler.handleChatMessage(username, message);
  });

  // Auto-start from CLI targets if provided
  const cliTargets = parseCliTargets();
  if (cliTargets) {
    logger.info(`Collector: auto-starting with CLI targets: ${cliTargets.map(t => `${t.item} x${t.count}`).join(', ')}`);
    executor.setTargets(cliTargets);
    executor.startNextTarget().catch(() => {});
  }
});
