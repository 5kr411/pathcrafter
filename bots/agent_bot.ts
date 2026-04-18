import * as dotenv from 'dotenv';
dotenv.config();

const mineflayer = require('mineflayer');

import { getConfig } from './collector/config';
import { WorkerManager } from './collector/worker_manager';
import { ReactiveBehaviorRegistry } from './collector/reactive_behavior_registry';
import { hostileMobBehavior } from './collector/reactive_behaviors/hostile_mob_behavior';
import { shieldDefenseBehavior } from './collector/reactive_behaviors/shield_defense_behavior';
import { hostileFleeBehavior } from './collector/reactive_behaviors/hostile_flee_behavior';
import { waterEscapeBehavior } from './collector/reactive_behaviors/water_escape_behavior';
import { armorUpgradeBehavior } from './collector/reactive_behaviors/armor_upgrade_behavior';
import { foodEatingBehavior } from './collector/reactive_behaviors/food_eating_behavior';
import { droppedFoodPickupBehavior } from './collector/reactive_behaviors/dropped_food_pickup_behavior';
import { opportunisticFoodHuntBehavior } from './collector/reactive_behaviors/opportunistic_food_hunt_behavior';
import { foodCollectionBehavior, setFoodCollectionConfig, resetFoodCollectionCooldown } from './collector/reactive_behaviors/food_collection_behavior';
import { foodSmeltingBehavior } from './collector/reactive_behaviors/food_smelting_behavior';
import { inventoryManagementBehavior, setInventoryManagementConfig } from './collector/reactive_behaviors/inventory_management_behavior';
import { CollectorControlStack } from './collector/control_stack';
import { setSafeFindRepeatThreshold, setLiquidAvoidanceDistance } from '../utils/config';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';
import { installExplosionSanitizer } from '../utils/explosionSanitizer';
import { installPacketErrorSuppressor } from '../utils/packetErrorSuppressor';
import logger from '../utils/logger';
import { resolveRunDir } from '../utils/runDir';

import { parseAgentBotArgs } from './agent_bot/cli';
import { createProvider } from './agent_bot/providers/factory';
import { ToolExecutor } from './agent_bot/tools/executor';
import { allTools } from './agent_bot/tools/registry';
import { AgentActionExecutor } from './agent_bot/action_executor';
import { AgentSession } from './agent_bot/agent_session';
import { AgentChatHandler } from './agent_bot/chat_handler';

const config = getConfig();

if (!process.env.LOG_LEVEL) {
  logger.setLevel(config.logLevel);
}

const cfg = parseAgentBotArgs(process.argv.slice(2));
const botOptions: any = { host: cfg.host, port: cfg.port, username: cfg.username };

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

  const safeChat = (msg: string): void => {
    try {
      if (bot && bot._client && !bot._client.ended) bot.chat(msg);
    } catch (_) {}
  };

  (bot as any).safeChat = safeChat;

  bot.on('kicked', (reason: string, loggedIn: boolean) => {
    logger.info(`AgentBot: kicked reason=${JSON.stringify(reason)} loggedIn=${loggedIn}`);
  });
  bot.on('end', (reason?: string) => {
    const endReason = reason ?? bot._client?._endReason ?? 'unknown';
    const ended = !!bot._client?.ended;
    const state = bot._client?.state;
    const socketWritable = !!bot._client?.socket?.writable;
    const serializerWritable = !!bot._client?.serializer?.writable;
    logger.info(`AgentBot: connection ended reason=${JSON.stringify(endReason)} ended=${ended} state=${state} sockWritable=${socketWritable} serWritable=${serializerWritable}`);
  });
  bot.on('error', (err: any) => {
    const code = err && err.code ? err.code : '';
    const msg = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : '';
    logger.info(`AgentBot: bot error code=${code} msg=${msg} stack=${stack}`);
  });

  // Surface low-level client errors separately — these are normally only routed through bot.on('error')
  // which mineflayer-loader installs, but catching at the client level gives us earlier signal.
  if (bot._client && typeof bot._client.on === 'function') {
    bot._client.on('error', (err: any) => {
      const code = err && err.code ? err.code : '';
      const msg = err && err.message ? err.message : String(err);
      logger.info(`AgentBot: _client error code=${code} msg=${msg}`);
    });
  }

  // Intercept client.end() so we can see WHO (what code path) is closing the socket and WHY.
  // This preserves original behavior — we just log before delegating.
  if (bot._client && typeof bot._client.end === 'function' && !bot._client._endWrapped) {
    const origEnd = bot._client.end.bind(bot._client);
    bot._client._endWrapped = true;
    bot._client.end = function(reason?: any, ...rest: any[]) {
      const stack = new Error().stack?.split('\n').slice(1, 6).join(' | ');
      logger.info(`AgentBot: _client.end called reason=${JSON.stringify(reason)} stack=${stack}`);
      return origEnd(reason, ...rest);
    };
  }

  // Node-level uncaught rejection / exception — if anything in our pipeline throws asynchronously
  // and isn't caught, this is where it'll show up.
  process.on('unhandledRejection', (reason: any) => {
    const msg = reason && reason.message ? reason.message : String(reason);
    const stack = reason && reason.stack ? reason.stack.split('\n').slice(0, 6).join(' | ') : '';
    logger.info(`AgentBot: unhandledRejection msg=${msg} stack=${stack}`);
  });
  process.on('uncaughtException', (err: any) => {
    const msg = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? err.stack.split('\n').slice(0, 6).join(' | ') : '';
    logger.info(`AgentBot: uncaughtException msg=${msg} stack=${stack}`);
  });

  // Initialize file logging
  const runDir = resolveRunDir();
  logger.initFileLogging(runDir, botOptions.username);

  const sp = bot.entity.position;
  logger.milestone(`bot ready — spawned at (${sp.x.toFixed(1)}, ${sp.y.toFixed(1)}, ${sp.z.toFixed(1)})`);
  safeChat('agent bot ready');

  const workerManager = new WorkerManager(
    () => {
      // Planning handlers are passed per request; ignore fallback results.
    },
    () => {}
  );

  const reactiveBehaviorRegistry = new ReactiveBehaviorRegistry();
  setFoodCollectionConfig({ triggerFoodPoints: 10, targetFoodPoints: 20 });
  reactiveBehaviorRegistry.register(shieldDefenseBehavior);
  reactiveBehaviorRegistry.register(hostileFleeBehavior);
  reactiveBehaviorRegistry.register(waterEscapeBehavior);
  reactiveBehaviorRegistry.register(hostileMobBehavior);
  reactiveBehaviorRegistry.register(armorUpgradeBehavior);
  reactiveBehaviorRegistry.register(foodCollectionBehavior);
  reactiveBehaviorRegistry.register(foodEatingBehavior);
  reactiveBehaviorRegistry.register(droppedFoodPickupBehavior);
  reactiveBehaviorRegistry.register(opportunisticFoodHuntBehavior);
  reactiveBehaviorRegistry.register(foodSmeltingBehavior);
  reactiveBehaviorRegistry.register(inventoryManagementBehavior);

  const agentActionLayer = new AgentActionExecutor(bot);

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
    reactiveBehaviorRegistry,
    agentActionLayer
  );
  controlStack.start();
  const executor = controlStack.targetLayer;

  setInventoryManagementConfig({
    getTargets: () => executor.getTargets()
  });

  const provider = createProvider(cfg.provider);
  const toolExecutor = new ToolExecutor(allTools());
  const session = new AgentSession({
    bot,
    provider,
    toolExecutor,
    targetExecutor: executor,
    agentActionExecutor: agentActionLayer,
    safeChat
  });
  const chatHandler = new AgentChatHandler(bot, session);

  let lastDeathMessage: string | null = null;

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
    logger.info(`AgentBot: bot died at ${posStr}, health=${health}, food=${food}, cause="${cause}" — resetting and retrying all targets`);
    lastDeathMessage = null;
    // Destroy the in-flight agent session — it's referencing a dead bot state.
    try { session.destroy(); } catch (_) {}
    // Reset food cooldown: respawn restores hunger to 20, so any prior "food is scarce" cooldown
    // is stale. Without this, a bot that died during its cooldown keeps the cooldown post-respawn
    // and may starve again before it can retry food collection.
    resetFoodCollectionCooldown();
    if (executor.isRunning() || executor.getTargets().length > 0) {
      executor.resetAndRestart();
    }
  });

  bot.on('end', () => {
    try { session.destroy(); } catch (_) {}
    workerManager.terminate();
    controlStack.stop();
    logger.close();
  });

  bot.on('chat', (username: string, message: string) => {
    chatHandler.handle(username, message);
  });

  // Auto-start from CLI targets if provided
  if (cfg.targets && cfg.targets.length > 0) {
    logger.info(`AgentBot: auto-starting with CLI targets: ${cfg.targets.map(t => `${t.item} x${t.count}`).join(', ')}`);
    executor.setTargets(cfg.targets);
    executor.startNextTarget().catch(() => {});
  }
});
