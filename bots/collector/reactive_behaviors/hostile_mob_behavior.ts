import { ReactiveBehavior, Bot } from './types';
import { ReactiveBehaviorExecutor } from '../reactive_behavior_executor';
import createHuntEntityState from '../../../behaviors/behaviorHuntEntity';
import { Vec3 } from 'vec3';
const minecraftData = require('minecraft-data');

const MAX_LOS_DISTANCE = 48; // Safety cap for ray traversal
const DEFAULT_EYE_HEIGHT = 1.62;

function getBotEyeHeight(bot: Bot): number {
  const entity: any = bot?.entity;
  if (entity && typeof entity.height === 'number' && entity.height > 0) {
    return entity.height;
  }
  return DEFAULT_EYE_HEIGHT;
}

function getEntityAimPoint(entity: any): Vec3 {
  const base = entity?.position;
  if (!base) {
    return new Vec3(0, 0, 0);
  }
  const height = typeof entity?.height === 'number' && entity.height > 0 ? entity.height : 1.8;
  const offsetY = Math.max(0.4, height * 0.5);
  return new Vec3(base.x, base.y + offsetY, base.z);
}

function isSolidBlock(block: any): boolean {
  if (!block) return false;
  if (block.transparent) return false;
  if (block.boundingBox && block.boundingBox !== 'block') return false;
  const name: string = (block.name || '').toLowerCase();
  if (name.includes('water') || name.includes('lava') || name.includes('vine')) return false;
  return true;
}

function hasLineOfSight(bot: Bot, entity: any): boolean {
  try {
    if (!bot || !bot.entity || !bot.entity.position || !entity || !entity.position) return false;
    if (typeof (bot as any).blockAt !== 'function') return true;

    const botPos = bot.entity.position;
    const eyeHeight = getBotEyeHeight(bot);
    const eyePos = new Vec3(botPos.x, botPos.y + eyeHeight, botPos.z);
    const targetPoint = getEntityAimPoint(entity);
    const direction = targetPoint.minus(eyePos);
    const distance = direction.norm();

    if (!Number.isFinite(distance) || distance <= 0.001) {
      return true;
    }

    const clampedDistance = Math.min(distance, MAX_LOS_DISTANCE);
    const samples = Math.max(1, Math.ceil(clampedDistance / 0.2));
    const step = direction.scaled(1 / samples);

    const botBlockX = Math.floor(botPos.x);
    const botBlockY = Math.floor(botPos.y);
    const botBlockZ = Math.floor(botPos.z);

    const targetBlockX = Math.floor(entity.position.x);
    const targetBlockY = Math.floor(entity.position.y);
    const targetBlockZ = Math.floor(entity.position.z);

    const visited = new Set<string>();

    for (let i = 1; i < samples; i++) {
      const point = eyePos.plus(step.scaled(i));
      if (point.distanceTo(targetPoint) <= 0.35) {
        break;
      }

      const blockX = Math.floor(point.x);
      const blockY = Math.floor(point.y);
      const blockZ = Math.floor(point.z);

      if (blockX === botBlockX && blockZ === botBlockZ && (blockY === botBlockY || blockY === botBlockY + 1)) {
        continue;
      }

      if (blockX === targetBlockX && blockZ === targetBlockZ) {
        const relativeY = blockY - targetBlockY;
        if (relativeY >= 0 && relativeY <= Math.ceil((entity.height && entity.height > 0 ? entity.height : 1.8))) {
          continue;
        }
      }

      const key = `${blockX},${blockY},${blockZ}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const blockPos = new Vec3(blockX, blockY, blockZ);
      const block = (bot as any).blockAt(blockPos, false);
      if (!block) continue;

      if (isSolidBlock(block)) {
        return false;
      }
    }

    return true;
  } catch (err) {
    return true;
  }
}

function getHostileMobNames(mcData: any): Set<string> {
  const hostileMobs = new Set<string>();
  
  if (!mcData) return hostileMobs;

  let entities: any[] = [];
  if (mcData.entities) {
    if (Array.isArray(mcData.entities)) {
      entities = mcData.entities;
    } else if (typeof mcData.entities === 'object') {
      entities = Object.values(mcData.entities);
    }
  }

  if (mcData.entitiesArray) {
    entities = mcData.entitiesArray;
  }

  for (const entity of entities) {
    if (!entity || !entity.name) continue;

    if (entity.type === 'hostile' || entity.category === 'hostile') {
      hostileMobs.add(entity.name);
      continue;
    }

    const name = entity.name.toLowerCase();
    const isHostile = 
      name.includes('zombie') || name.includes('skeleton') || 
      name.includes('creeper') || name.includes('spider') || 
      name.includes('enderman') || name.includes('witch') || 
      name.includes('blaze') || name.includes('ghast') || 
      name.includes('magma_cube') || name.includes('slime') ||
      name.includes('piglin') || name.includes('hoglin') || 
      name.includes('zoglin') || name.includes('pillager') ||
      name.includes('vindicator') || name.includes('evoker') || 
      name.includes('ravager') || name.includes('vex') || 
      name.includes('phantom') || name.includes('drowned') || 
      name.includes('husk') || name.includes('stray') || 
      name.includes('wither') || name.includes('endermite') ||
      name.includes('silverfish') || name.includes('guardian') || 
      name.includes('shulker') || name.includes('ender_dragon');

    if (isHostile) {
      hostileMobs.add(entity.name);
    }
  }

  return hostileMobs;
}

function findClosestHostileMob(bot: Bot, maxDistance: number = 16): any | null {
  if (!bot.entities) return null;

  const mcData = minecraftData(bot.version);
  const hostileMobNames = getHostileMobNames(mcData);

  let closest: any = null;
  let closestDistance = Infinity;
  const botPos = bot.entity?.position;

  if (!botPos || !botPos.distanceTo) return null;

  for (const key in bot.entities) {
    const entity = bot.entities[key];
    if (!entity || !entity.position) continue;

    const entityName = entity.name || entity.displayName || '';
    if (!hostileMobNames.has(entityName)) continue;

    if (typeof entity.isAlive === 'function' && !entity.isAlive()) continue;
    if (typeof entity.health === 'number' && entity.health <= 0) continue;

    const distance = botPos.distanceTo(entity.position);
    if (distance > maxDistance) continue;

    if (!hasLineOfSight(bot, entity)) continue;

    if (distance < closestDistance) {
      closest = entity;
      closestDistance = distance;
    }
  }

  return closest;
}

export const hostileMobBehavior: ReactiveBehavior = {
  priority: 100,
  name: 'hostile_mob_combat',

  shouldActivate: (bot: Bot): boolean => {
    const hostileMob = findClosestHostileMob(bot, 16);
    return hostileMob !== null;
  },

  execute: async (bot: Bot, executor: ReactiveBehaviorExecutor): Promise<any> => {
    const hostileMob = findClosestHostileMob(bot, 32);
    
    if (!hostileMob) {
      executor.finish(false);
      return null;
    }

    const sendChat: (msg: string) => void = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : (msg: string) => {
          try {
            if (bot && typeof bot.chat === 'function') {
              bot.chat(msg);
            }
          } catch (_) {}
        };

    const mobLabel = String(hostileMob.displayName || hostileMob.name || 'mob');
    let startAnnounced = false;
    let fightFinished = false;

    const announceStart = () => {
      if (!startAnnounced) {
        sendChat(`fighting ${mobLabel}`);
        startAnnounced = true;
      }
    };

    const targets: any = {
      entity: hostileMob,
      entityFilter: (entity: any) => {
        if (!entity || !entity.name) return false;
        const mcData = minecraftData(bot.version);
        const hostileMobNames = getHostileMobNames(mcData);
        return hostileMobNames.has(entity.name);
      },
      detectionRange: 32,
      attackRange: 3.5
    };

    const stateMachine = createHuntEntityState(bot, targets);

    let completionInterval: NodeJS.Timeout | null = null;
    const clearCompletionInterval = () => {
      if (completionInterval) {
        clearInterval(completionInterval);
        completionInterval = null;
      }
    };

    const finishFight = (success: boolean) => {
      if (fightFinished) {
        return;
      }
      fightFinished = true;
      clearCompletionInterval();
      if (startAnnounced) {
        sendChat(`${success ? 'done fighting' : 'stopped fighting'} ${mobLabel}`);
      }
      executor.finish(success);
    };

    announceStart();
    
    const checkCompletion = () => {
      try {
        if (typeof stateMachine.isFinished === 'function' && stateMachine.isFinished()) {
          finishFight(true);
        }
      } catch (err) {
      }
    };

    completionInterval = setInterval(checkCompletion, 100);

    const originalOnStateExited = stateMachine.onStateExited;
    stateMachine.onStateExited = function() {
      clearCompletionInterval();
      if (originalOnStateExited) {
        try {
          originalOnStateExited.call(this);
        } catch (_) {}
      }
      finishFight(true);
    };

    return stateMachine;
  },

  onDeactivate: () => {
  }
};

