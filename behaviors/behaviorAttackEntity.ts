const {
  StateTransition,
  BehaviorIdle,
  BehaviorEquipItem,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import createLookAtState, { getNearestPointOnEntityBoundingBox } from './behaviorLookAt';
import { Vec3 } from 'vec3';

interface Bot {
  version?: string;
  entity?: {
    position: any;
    yaw: number;
    pitch: number;
  };
  inventory?: {
    items?: () => any[];
  };
  attack?: (entity: any) => Promise<void>;
  heldItem?: any;
  lookAt?: (position: any, force?: boolean, callback?: () => void) => void;
  [key: string]: any;
}

interface Entity {
  position?: any;
  health?: number;
  isAlive?: () => boolean;
  [key: string]: any;
}

interface Targets {
  entity?: Entity | null;
  [key: string]: any;
}

function pickBestWeapon(bot: Bot): any | null {
  const items = bot.inventory?.items?.() || [];
  const registry = bot.registry?.items ?? {};

  type WeaponDescriptor = {
    matches: (name: string) => boolean;
    type: 'sword' | 'axe' | 'trident' | 'bow' | 'crossbow';
    baseScore: number;
  };

  const descriptors: WeaponDescriptor[] = [
    { matches: (name) => name.endsWith('_sword'), type: 'sword', baseScore: 400 },
    { matches: (name) => name.endsWith('_axe'), type: 'axe', baseScore: 320 },
    { matches: (name) => name === 'trident', type: 'trident', baseScore: 300 },
    { matches: (name) => name === 'bow', type: 'bow', baseScore: 200 },
    { matches: (name) => name === 'crossbow', type: 'crossbow', baseScore: 180 }
  ];

  const materialPriority = new Map<string, number>([
    ['netherite', 70],
    ['diamond', 60],
    ['iron', 50],
    ['stone', 40],
    ['golden', 35],
    ['gold', 35],
    ['copper', 33],
    ['wooden', 25],
    ['wood', 25]
  ]);

  const getMaterialScore = (itemName: string): number => {
    const prefix = itemName.split('_')[0];
    return materialPriority.get(prefix) ?? 0;
  };

  let bestWeapon: any = null;
  let bestScore = -Infinity;

  for (const item of items) {
    if (!item || !item.name) continue;

    const descriptor = descriptors.find((desc) => desc.matches(item.name));
    if (!descriptor) continue;

    const attackDamage = registry[item.type]?.attackDamage ?? 0;
    const materialScore = getMaterialScore(item.name);

    // Weapon type should dominate, but prefer higher damage/material within the same type.
    const score = descriptor.baseScore + attackDamage * 10 + materialScore;

    if (score > bestScore) {
      bestScore = score;
      bestWeapon = item;
    }
  }

  return bestWeapon;
}

function getDistanceToEntity(bot: Bot, entity: Entity): number {
  if (!bot.entity?.position || !entity?.position || !bot.entity.position.distanceTo) {
    return Infinity;
  }
  return bot.entity.position.distanceTo(entity.position);
}
function getEntityAimPoint(bot: Bot, entity: Entity): any {
  if (!bot?.entity?.position || !entity) {
    return entity?.position || null;
  }

  const botPos = bot.entity.position;
  const eyeHeightCandidate = (bot.entity as any)?.height;
  const eyeHeight = typeof eyeHeightCandidate === 'number' && eyeHeightCandidate > 0 ? eyeHeightCandidate : 1.62;
  const botEyePos = botPos.clone ? botPos.clone() : new Vec3(botPos.x, botPos.y, botPos.z);
  if (botEyePos && typeof botEyePos.y === 'number') {
    botEyePos.y += eyeHeight;
  }

  const aim = getNearestPointOnEntityBoundingBox(botEyePos, entity);
  if (!aim) {
    return entity.position ?? null;
  }

  return aim;
}

class BehaviorAttackEntityState {
  bot: Bot;
  targets: Targets;
  isFinished: boolean = false;

  constructor(bot: Bot, targets: Targets) {
    this.bot = bot;
    this.targets = targets;
  }

  onStateEntered(): void {
    this.isFinished = false;

    if (!this.targets.entity) {
      logger.info('BehaviorAttackEntity: no entity target');
      this.isFinished = true;
      return;
    }

    const entity = this.targets.entity;
    const distance = getDistanceToEntity(this.bot, entity);
    const ATTACK_RANGE = 3.0;
    
    // Check if entity is still valid (exists in bot.entities)
    const isValid = this.bot.entities && Object.values(this.bot.entities).some((e: any) => e.id === entity.id);

    if (distance > ATTACK_RANGE) {
      logger.info(`BehaviorAttackEntity: entity too far (${distance.toFixed(2)} > ${ATTACK_RANGE})`);
      this.isFinished = true;
      return;
    }

    if (!isValid) {
      logger.info('BehaviorAttackEntity: entity no longer valid');
      this.isFinished = true;
      return;
    }

    if (!this.bot.attack) {
      logger.info('BehaviorAttackEntity: bot.attack not available');
      this.isFinished = true;
      return;
    }

    const aimPoint = getEntityAimPoint(this.bot, entity);
    if (aimPoint && typeof this.bot.lookAt === 'function') {
      try {
        this.bot.lookAt(aimPoint, true);
      } catch (err: any) {
        logger.debug(`BehaviorAttackEntity: failed to pre-align look - ${err?.message || err}`);
      }
    }

    logger.info(`BehaviorAttackEntity: attacking ${entity.name || entity.displayName || 'entity'} at distance ${distance.toFixed(2)}`);

    try {
      const result = this.bot.attack(entity);
      // bot.attack might return undefined or a promise
      if (result && typeof result.then === 'function') {
        result.then(() => {
          logger.info('BehaviorAttackEntity: attack completed');
          this.isFinished = true;
        }).catch((err: any) => {
          logger.info(`BehaviorAttackEntity: attack failed - ${err?.message || err}`);
          this.isFinished = true;
        });
      } else {
        // Attack is synchronous, mark as finished immediately
        logger.info('BehaviorAttackEntity: attack completed');
        this.isFinished = true;
      }
    } catch (err: any) {
      logger.info(`BehaviorAttackEntity: error calling attack - ${err?.message || err}`);
      this.isFinished = true;
    }
  }

  onStateExited(): void {
    this.isFinished = false;
  }
}

function createAttackEntityState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();

  const equipTargets: { item: any } = { item: null };
  const equipWeapon = new BehaviorEquipItem(bot, equipTargets);

  addStateLogging(equipWeapon, 'EquipItem', {
    logEnter: true,
    getExtraInfo: () => (equipTargets.item ? `equipping ${equipTargets.item.name}` : 'no weapon to equip')
  });

  // Create look-at state that will use entity's bounding box
  const lookTargets: any = {};
  
  const lookAtEntity = createLookAtState(bot, lookTargets, 3.0, null);

  const attackState = new BehaviorAttackEntityState(bot, targets);
  const fastAttack = Boolean((targets as any).fastAttack);

  addStateLogging(attackState, 'AttackEntity', {
    logEnter: true,
    getExtraInfo: () => {
      const entity = targets.entity;
      if (!entity) return 'no entity';
      const distance = getDistanceToEntity(bot, entity);
      return `attacking entity at distance ${distance.toFixed(2)}`;
    }
  });

  const exit = new BehaviorIdle();

  const enterToEquip = new StateTransition({
    parent: enter,
    child: equipWeapon,
    name: 'BehaviorAttackEntity: enter -> equip weapon',
    shouldTransition: () => {
      const weapon = pickBestWeapon(bot);
      equipTargets.item = weapon;
      return weapon !== null;
    },
    onTransition: () => {
      const weapon = equipTargets.item;
      logger.debug(`BehaviorAttackEntity: selecting weapon ${weapon?.name || 'none'}`);
    }
  });

  const enterToLook = new StateTransition({
    parent: enter,
    child: lookAtEntity,
    name: 'BehaviorAttackEntity: enter -> look (no weapon)',
    shouldTransition: () => !fastAttack && pickBestWeapon(bot) === null,
    onTransition: () => {
      // Pass the entity to lookAtEntity for bounding box calculation
      if (targets.entity) {
        // Update the lookAtEntity's entity reference
        (lookAtEntity as any).entity = targets.entity;
      }
      logger.info('BehaviorAttackEntity: no weapon available, proceeding to look at target');
    }
  });

  const equipToLook = new StateTransition({
    parent: equipWeapon,
    child: lookAtEntity,
    name: 'BehaviorAttackEntity: equip -> look',
    shouldTransition: () => {
      if (fastAttack) {
        return false;
      }
      if (typeof equipWeapon.isFinished === 'function') {
        return equipWeapon.isFinished();
      }
      return true;
    },
    onTransition: () => {
      // Pass the entity to lookAtEntity for bounding box calculation
      if (targets.entity) {
        // Update the lookAtEntity's entity reference
        (lookAtEntity as any).entity = targets.entity;
      }
      logger.info('BehaviorAttackEntity: weapon equipped, proceeding to look at target');
    }
  });

  const enterToAttackDirect = new StateTransition({
    parent: enter,
    child: attackState,
    name: 'BehaviorAttackEntity: enter -> attack (fast)',
    shouldTransition: () => fastAttack && pickBestWeapon(bot) === null,
    onTransition: () => {
      logger.info('BehaviorAttackEntity: fast-attack mode without weapon, attacking immediately');
    }
  });

  const equipToAttackFast = new StateTransition({
    parent: equipWeapon,
    child: attackState,
    name: 'BehaviorAttackEntity: equip -> attack (fast)',
    shouldTransition: () => {
      if (!fastAttack) {
        return false;
      }
      if (typeof equipWeapon.isFinished === 'function') {
        return equipWeapon.isFinished();
      }
      return true;
    },
    onTransition: () => {
      logger.info('BehaviorAttackEntity: fast-attack mode, skipping look and attacking immediately');
    }
  });

  const lookToExit = new StateTransition({
    parent: lookAtEntity,
    child: exit,
    name: 'BehaviorAttackEntity: look -> exit (too far)',
    shouldTransition: () => {
      const lookFinished = typeof lookAtEntity.isFinished === 'function' 
        ? lookAtEntity.isFinished() 
        : lookAtEntity.isFinished === true;
      
      if (!lookFinished) return false;
      
      const ATTACK_RANGE = 3.0;
      if (!targets.entity) return true;
      
      const distance = getDistanceToEntity(bot, targets.entity);
      return distance > ATTACK_RANGE;
    },
    onTransition: () => {
      const distance = targets.entity ? getDistanceToEntity(bot, targets.entity) : 0;
      logger.info(`BehaviorAttackEntity: entity too far after rotation (${distance.toFixed(2)} > 3.0), exiting`);
      targets.entity = null;
    }
  });

  const lookToAttack = new StateTransition({
    parent: lookAtEntity,
    child: attackState,
    name: 'BehaviorAttackEntity: look -> attack',
    shouldTransition: () => {
      const lookFinished = typeof lookAtEntity.isFinished === 'function' 
        ? lookAtEntity.isFinished() 
        : lookAtEntity.isFinished === true;
      
      if (!lookFinished) return false;
      
      const ATTACK_RANGE = 3.0;
      if (!targets.entity) return false;
      
      const distance = getDistanceToEntity(bot, targets.entity);
      return distance <= ATTACK_RANGE;
    },
    onTransition: () => {
      logger.info('BehaviorAttackEntity: finished looking and in range, now attacking');
    }
  });

  const attackToExit = new StateTransition({
    parent: attackState,
    child: exit,
    name: 'BehaviorAttackEntity: attack -> exit',
    shouldTransition: () => attackState.isFinished,
    onTransition: () => {
      logger.info('BehaviorAttackEntity: attack complete');
      targets.entity = null;
    }
  });

  const transitions = [
    enterToEquip,
    enterToLook,
    equipToLook,
    enterToAttackDirect,
    equipToAttackFast,
    lookToExit,
    lookToAttack,
    attackToExit
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  stateMachine.onStateExited = function() {
    logger.debug('AttackEntity: cleaning up on state exit');
    try {
      bot.clearControlStates?.();
    } catch (err: any) {
      logger.debug(`AttackEntity: error clearing control states: ${err.message}`);
    }
  };

  return stateMachine;
}

export default createAttackEntityState;

