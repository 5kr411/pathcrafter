import { ReactiveBehavior, Bot } from './types';
import { ReactiveBehaviorExecutor } from '../reactive_behavior_executor';
import createHuntEntityState from '../../../behaviors/behaviorHuntEntity';
const minecraftData = require('minecraft-data');

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
    
    const checkCompletion = () => {
      try {
        if (typeof stateMachine.isFinished === 'function' && stateMachine.isFinished()) {
          if (completionInterval) {
            clearInterval(completionInterval);
            completionInterval = null;
          }
          executor.finish(true);
        }
      } catch (err) {
      }
    };

    completionInterval = setInterval(checkCompletion, 100);

    const originalOnStateExited = stateMachine.onStateExited;
    stateMachine.onStateExited = function() {
      if (completionInterval) {
        clearInterval(completionInterval);
        completionInterval = null;
      }
      if (originalOnStateExited) {
        originalOnStateExited();
      }
    };

    return stateMachine;
  },

  onDeactivate: () => {
  }
};

