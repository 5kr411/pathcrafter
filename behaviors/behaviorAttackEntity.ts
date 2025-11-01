const {
  StateTransition,
  BehaviorIdle,
  BehaviorEquipItem,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import createLookAtState from './behaviorLookAt';

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
  const weaponNames = ['sword', 'axe', 'trident', 'bow', 'crossbow'];
  
  const weaponPriorities: Record<string, number> = {
    sword: 100,
    axe: 80,
    trident: 60,
    bow: 40,
    crossbow: 30
  };

  let bestWeapon: any = null;
  let bestPriority = -1;

  for (const item of items) {
    if (!item || !item.name) continue;
    
    for (const weaponName of weaponNames) {
      if (item.name.includes(weaponName)) {
        const priority = weaponPriorities[weaponName] || 0;
        if (priority > bestPriority) {
          bestWeapon = item;
          bestPriority = priority;
          break;
        }
      }
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

// Old BehaviorLookAtEntityState removed - now using createLookAtState from behaviorLookAt.ts

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
    shouldTransition: () => pickBestWeapon(bot) === null,
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

