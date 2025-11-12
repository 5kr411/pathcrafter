import logger from '../../../utils/logger';
import { ReactiveBehavior, Bot } from './types';
import { ReactiveBehaviorExecutor } from '../reactive_behavior_executor';
import { findClosestHostileMob, getHostileMobNames, hasLineOfSight } from './hostile_mob_behavior';
import { createShieldDefenseState } from '../../../behaviors/behaviorShieldDefense';

const minecraftData = require('minecraft-data');

const SHIELD_HOLD_DURATION_MS = 5000;
const CREEPER_TRIGGER_RADIUS = 8;
const CREEPER_REACQUIRE_RADIUS = 8;
const HOSTILE_SEARCH_RADIUS = 32;

function getInventoryItems(bot: Bot): any[] {
  const inventory: any = (bot as any)?.inventory;
  if (!inventory) {
    return [];
  }

  try {
    if (typeof inventory.items === 'function') {
      const items = inventory.items();
      if (Array.isArray(items)) {
        return items.filter((item: any) => !!item);
      }
    }
  } catch (err: any) {
    logger.debug(`ShieldDefense: failed to enumerate inventory items - ${err?.message || err}`);
  }

  const slots = inventory.slots;
  if (!Array.isArray(slots)) {
    return [];
  }

  return slots.filter((item: any) => !!item);
}

function getOffhandItem(bot: Bot): any | null {
  try {
    if (typeof (bot as any)?.getEquipmentDestSlot !== 'function') {
      return null;
    }
    const offHandIndex = (bot as any).getEquipmentDestSlot('off-hand');
    const slots = (bot as any)?.inventory?.slots;
    if (!Array.isArray(slots) || !Number.isInteger(offHandIndex) || offHandIndex < 0 || offHandIndex >= slots.length) {
      return null;
    }
    return slots[offHandIndex] ?? null;
  } catch (err: any) {
    logger.debug(`ShieldDefense: unable to read off-hand slot - ${err?.message || err}`);
    return null;
  }
}

export function hasShieldInOffhand(bot: Bot): boolean {
  const item = getOffhandItem(bot);
  if (!item || typeof item.name !== 'string') {
    return false;
  }
  return item.name.toLowerCase() === 'shield';
}

export function findShieldItem(bot: Bot): any | null {
  if (hasShieldInOffhand(bot)) {
    return getOffhandItem(bot);
  }

  const items = getInventoryItems(bot);
  for (const item of items) {
    if (!item || typeof item.name !== 'string') continue;
    if (item.name.toLowerCase() === 'shield') {
      return item;
    }
  }

  return null;
}

export async function ensureShieldEquipped(bot: Bot, preferredShield?: any): Promise<boolean> {
  if (hasShieldInOffhand(bot)) {
    return true;
  }

  const equipFn = (bot as any)?.equip;
  if (typeof equipFn !== 'function') {
    logger.debug('ShieldDefense: bot does not support equip, cannot ready shield');
    return false;
  }

  const shieldItem = preferredShield ?? findShieldItem(bot);
  if (!shieldItem) {
    return false;
  }

  try {
    await equipFn.call(bot, shieldItem, 'off-hand');
  } catch (err: any) {
    logger.info(`ShieldDefense: failed to equip shield in off-hand - ${err?.message || err}`);
    return false;
  }

  return hasShieldInOffhand(bot);
}

export function shouldContinueShieldDefense(bot: Bot): boolean {
  const { current, max } = getBotHealthInfo(bot);
  if (current <= 0) {
    logger.debug('ShieldDefense: continue check failed - health <= 0');
    return false;
  }

  const lowHealth = max > 0 && current < max / 2;
  const creeperThreat = findClosestCreeper(bot, CREEPER_REACQUIRE_RADIUS);
  if (creeperThreat) {
    return true;
  }

  if (!lowHealth) {
    logger.debug('ShieldDefense: continue check failed - health recovered and no creeper');
    return false;
  }

  const nearbyHostile = findClosestHostileMob(bot, HOSTILE_SEARCH_RADIUS, true);
  if (!nearbyHostile) {
    logger.debug('ShieldDefense: continue check failed - low health but no hostile in close range');
  }
  return !!nearbyHostile;
}

function isEntityAlive(entity: any): boolean {
  if (!entity) return false;
  if (typeof entity.isAlive === 'function') {
    return entity.isAlive();
  }
  if (typeof entity.health === 'number') {
    return entity.health > 0;
  }
  return true;
}

export function findClosestCreeper(bot: Bot, maxDistance: number): any | null {
  if (!bot?.entity?.position || typeof bot.entity.position.distanceTo !== 'function') {
    return null;
  }
  if (!bot.entities) {
    return null;
  }

  let closest: any = null;
  let closestDistance = Infinity;
  const botPos = bot.entity.position;

  for (const key in bot.entities) {
    const entity = bot.entities[key];
    if (!entity || !entity.position || typeof entity.position.distanceTo !== 'function') continue;
    const name = String(entity.name || entity.displayName || '').toLowerCase();
    if (name !== 'creeper') continue;
    if (!isEntityAlive(entity)) continue;

    try {
      const distance = botPos.distanceTo(entity.position);
      if (Number.isFinite(maxDistance) && maxDistance > 0 && distance > maxDistance) {
        continue;
      }
      if (!hasLineOfSight(bot, entity)) {
        continue;
      }
      if (distance < closestDistance) {
        closest = entity;
        closestDistance = distance;
      }
    } catch (err: any) {
      logger.debug(`ShieldDefense: failed computing creeper distance - ${err?.message || err}`);
    }
  }

  return closest;
}

interface HealthInfo {
  current: number;
  max: number;
}

function getBotHealthInfo(bot: Bot): HealthInfo {
  const entity: any = bot?.entity;
  const candidates: Array<number | null> = [];

  if (typeof (bot as any)?.health === 'number') {
    candidates.push((bot as any).health);
  }
  if (typeof entity?.health === 'number') {
    candidates.push(entity.health);
  }

  const current = candidates.find((value) => typeof value === 'number' && Number.isFinite(value)) ?? 0;

  let max: number | null = null;
  if (typeof (bot as any)?.maxHealth === 'number' && Number.isFinite((bot as any).maxHealth)) {
    max = (bot as any).maxHealth;
  } else if (typeof entity?.maxHealth === 'number' && Number.isFinite(entity.maxHealth)) {
    max = entity.maxHealth;
  }

  if (!Number.isFinite(max) || !max || max <= 0) {
    max = 20;
  }

  return {
    current: Number.isFinite(current) ? current : 0,
    max
  };
}

function createHostileNameSet(bot: Bot): Set<string> {
  try {
    const mcData = minecraftData(bot?.version);
    const names = getHostileMobNames(mcData);
    const set = new Set<string>();
    for (const name of names) {
      if (!name) continue;
      set.add(String(name).toLowerCase());
    }
    set.add('creeper');
    return set;
  } catch (err: any) {
    logger.debug(`ShieldDefense: failed to build hostile name set - ${err?.message || err}`);
    return new Set<string>(['creeper', 'zombie', 'skeleton', 'spider', 'husk', 'drowned']);
  }
}

export const shieldDefenseBehavior: ReactiveBehavior = {
  priority: 120,
  name: 'shield_defense',

  shouldActivate: (bot: Bot): boolean => {
    const shieldItem = findShieldItem(bot);
    if (!shieldItem) {
      return false;
    }

    const { current, max } = getBotHealthInfo(bot);
    if (current <= 0) {
      return false;
    }

    const creeperThreat = findClosestCreeper(bot, CREEPER_TRIGGER_RADIUS);
    if (creeperThreat) {
      return true;
    }

    const lowHealth = max > 0 && current < max / 2;
    if (!lowHealth) {
      return false;
    }

    const nearbyHostile = findClosestHostileMob(bot, HOSTILE_SEARCH_RADIUS);
    if (!nearbyHostile) {
        return false;
    }

    return true;
  },

  execute: async (bot: Bot, executor: ReactiveBehaviorExecutor): Promise<any> => {
    try {
      const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
        ? (bot as any).safeChat.bind(bot)
        : typeof bot?.chat === 'function'
          ? bot.chat.bind(bot)
          : null;

      const shieldItem = findShieldItem(bot);
      if (!shieldItem) {
        executor.finish(false);
        return null;
      }

      const equipped = await ensureShieldEquipped(bot, shieldItem);
      if (!equipped) {
        executor.finish(false);
        return null;
      }

      if (!shouldContinueShieldDefense(bot)) {
        executor.finish(false);
        return null;
      }

      const hostileNameSet = createHostileNameSet(bot);

      const reacquireThreat = (): any | null => {
        const creeper = findClosestCreeper(bot, CREEPER_REACQUIRE_RADIUS);
        if (creeper) {
          return creeper;
        }
        try {
          return findClosestHostileMob(bot, HOSTILE_SEARCH_RADIUS, true);
        } catch (err: any) {
          logger.debug(`ShieldDefense: threat lookup failed - ${err?.message || err}`);
          return null;
        }
      };

      const initialThreat = reacquireThreat();
      const threatName = initialThreat 
        ? String(initialThreat.name || initialThreat.displayName || 'hostile mob')
        : 'hostile mob';

      const targets: any = {
        entity: initialThreat ?? null,
        entityFilter: (entity: any) => {
          const name = String(entity?.name || entity?.displayName || '').toLowerCase();
          if (!name) return false;
          return hostileNameSet.has(name);
        },
        detectionRange: HOSTILE_SEARCH_RADIUS,
        attackRange: 3.5,
        fastAttack: true
      };

      const stateMachine = createShieldDefenseState(bot, {
        targets,
        reacquireThreat,
        holdDurationMs: SHIELD_HOLD_DURATION_MS,
        shouldContinue: () => shouldContinueShieldDefense(bot),
        onFinished: (success: boolean) => {
          finishBehavior(success, success ? 'done shielding' : undefined);
        }
      });

      let finished = false;
      let deathListener: (() => void) | null = null;

      const removeDeathListener = () => {
        if (!deathListener) {
          return;
        }
        try {
          if (typeof (bot as any)?.off === 'function') {
            (bot as any).off('death', deathListener);
          } else if (typeof (bot as any)?.removeListener === 'function') {
            (bot as any).removeListener('death', deathListener);
          }
        } catch (err: any) {
          logger.debug(`ShieldDefense: failed to detach death listener - ${err?.message || err}`);
        }
        deathListener = null;
      };

      const finishBehavior = (success: boolean, message?: string) => {
        if (finished) {
          return;
        }
        finished = true;
        removeDeathListener();
        executor.finish(success);
        if (message && sendChat) {
          try {
            sendChat(message);
          } catch (_) {
          }
        }
      };

      const attachDeathListener = () => {
        if (deathListener) {
          return;
        }
        const handler = () => finishBehavior(false);
        deathListener = handler;
        try {
          if (typeof (bot as any)?.on === 'function') {
            (bot as any).on('death', handler);
          } else if (typeof (bot as any)?.addListener === 'function') {
            (bot as any).addListener('death', handler);
          }
        } catch (err: any) {
          logger.debug(`ShieldDefense: failed to attach death listener - ${err?.message || err}`);
          removeDeathListener();
        }
      };

      attachDeathListener();

      logger.info(`ShieldDefense: reactive shield behavior engaged against ${threatName}`);
      if (sendChat) {
        try {
          sendChat(`shielding against ${threatName}`);
        } catch (_) {
        }
      }
      return stateMachine;
    } catch (err: any) {
      logger.info(`ShieldDefense: failed to execute - ${err?.message || err}`);
      executor.finish(false);
      return null;
    }
  },

  onDeactivate: () => {}
};
