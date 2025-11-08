import {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  StateBehavior
} from 'mineflayer-statemachine';

import createFollowAndAttackEntityState from './behaviorFollowAndAttackEntity';
import logger from '../utils/logger';
import { Vec3 } from 'vec3';

export interface ShieldDefenseStateConfig {
  targets: any;
  reacquireThreat: () => any | null;
  holdDurationMs?: number;
  shouldContinue: () => boolean;
  onFinished?: (success: boolean) => void;
}

class ShieldHoldState implements StateBehavior {
  public stateName = 'ShieldHold';
  public active = false;
  private finished = false;
  private holdTimer: NodeJS.Timeout | null = null;
  private threatInterval: NodeJS.Timeout | null = null;
  private damageCheckInterval: NodeJS.Timeout | null = null;
  private pendingThreat: any = null;
  private currentThreat: any = null;
  private offHandSlot: number | null = null;
  private lastShieldDamage: number | null = null;

  constructor(
    private readonly bot: any,
    private readonly holdDurationMs: number,
    private readonly reacquireThreat: () => any | null,
    private readonly shouldContinue: () => boolean
  ) {}

  onStateEntered(): void {
    logger.debug('ShieldDefense: onStateEntered called, resetting state');
    this.finished = false;
    this.pendingThreat = null;
    this.active = true;

    try {
      if (typeof this.bot?.activateItem === 'function') {
        this.bot.activateItem(true);
      }
    } catch (err: any) {
      logger.debug(`ShieldDefense: failed to raise shield - ${err?.message || err}`);
    }

    this.offHandSlot = this.getOffhandSlot();
    const initialShieldItem = this.getItemInSlot(this.offHandSlot);
    this.lastShieldDamage = this.getShieldDamage(initialShieldItem);
    
    logger.info(`ShieldDefense: initialized shield damage tracking - slot=${this.offHandSlot}, durability=${this.lastShieldDamage}/${initialShieldItem?.maxDurability || '?'}`)

    // Initialize threat data without looking to prevent head snap
    try {
      const threat = this.reacquireThreat();
      this.currentThreat = threat || null;
      if (threat) {
        if (this.isCreeper(threat)) {
          this.pendingThreat = null;
        } else {
          this.pendingThreat = threat;
        }
      } else {
        this.pendingThreat = null;
      }
    } catch (err: any) {
      logger.debug(`ShieldDefense: error while acquiring initial threat - ${err?.message || err}`);
    }
    
    this.startThreatPolling();
    this.startDamageChecking();
    this.startHoldTimer();
  }

  onStateExited(): void {
    logger.debug('ShieldDefense: onStateExited called');
    this.cleanup(false);
  }

  isFinished(): boolean {
    return this.finished;
  }

  getNextThreat(): any | null {
    return this.pendingThreat;
  }

  consumeNextThreat(): any | null {
    const threat = this.pendingThreat;
    this.pendingThreat = null;
    return threat;
  }

  cancel(): void {
    this.cleanup(true);
  }

  private cleanup(resetThreat: boolean): void {
    this.clearTimers();
    this.finished = false;
    if (resetThreat) {
      this.pendingThreat = null;
      this.currentThreat = null;
    }
    this.active = false;

    try {
      if (typeof this.bot?.deactivateItem === 'function') {
        this.bot.deactivateItem();
      }
    } catch (err: any) {
      logger.debug(`ShieldDefense: failed to lower shield - ${err?.message || err}`);
    }

    try {
      this.bot.clearControlStates?.();
    } catch (err: any) {
      logger.debug(`ShieldDefense: error clearing control states - ${err?.message || err}`);
    }
  }

  private clearTimers(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.threatInterval) {
      clearInterval(this.threatInterval);
      this.threatInterval = null;
    }
    if (this.damageCheckInterval) {
      clearInterval(this.damageCheckInterval);
      this.damageCheckInterval = null;
    }
  }

  private startHoldTimer(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }

    this.finished = false;
    const duration = Math.max(250, this.holdDurationMs);
    this.holdTimer = setTimeout(() => {
      // Update threat data without looking (we're about to attack)
      try {
        const threat = this.reacquireThreat();
        this.currentThreat = threat || null;
        if (threat) {
          if (this.isCreeper(threat)) {
            this.pendingThreat = null;
          } else {
            this.pendingThreat = threat;
          }
        } else {
          this.pendingThreat = null;
        }
      } catch (err: any) {
        logger.debug(`ShieldDefense: error while acquiring threat in timeout - ${err?.message || err}`);
      }

      const continueShielding = this.evaluateShouldContinue();
      logger.debug(`ShieldDefense: hold timer fired - continueShielding=${continueShielding}, isCreeper=${this.isCreeper(this.currentThreat)}, pendingThreat=${!!this.pendingThreat}`);
      
      if (this.isCreeper(this.currentThreat)) {
        logger.debug('ShieldDefense: hold timer restarting for creeper');
        this.startHoldTimer();
        return;
      }

      if (!this.pendingThreat && continueShielding) {
        logger.debug('ShieldDefense: hold timer restarting - no pending threat but should continue');
        this.startHoldTimer();
        return;
      }

      logger.info('ShieldDefense: hold timer finished, marking state as finished');
      this.finished = true;
    }, duration);
  }

  private startThreatPolling(): void {
    if (this.threatInterval) {
      clearInterval(this.threatInterval);
      this.threatInterval = null;
    }

    const intervalMs = Math.max(200, Math.min(1000, Math.floor(this.holdDurationMs / 3)));
    this.threatInterval = setInterval(() => {
      // Update threat data and look using smooth angle calculation
      let threat: any = null;
      try {
        threat = this.reacquireThreat();
      } catch (err: any) {
        logger.debug(`ShieldDefense: error while acquiring threat - ${err?.message || err}`);
      }

      this.currentThreat = threat || null;

      if (threat) {
        if (this.isCreeper(threat)) {
          this.pendingThreat = null;
        } else {
          this.pendingThreat = threat;
        }
        this.lookAtThreatSmooth(threat);
      } else {
        this.pendingThreat = null;
      }
    }, intervalMs);
  }

  private startDamageChecking(): void {
    if (this.damageCheckInterval) {
      clearInterval(this.damageCheckInterval);
      this.damageCheckInterval = null;
    }

    this.damageCheckInterval = setInterval(() => {
      if (!this.active || this.finished) {
        return;
      }

      const currentItem = this.getItemInSlot(this.offHandSlot);
      if (!this.isShieldItem(currentItem)) {
        logger.info('ShieldDefense: shield no longer equipped, finishing');
        this.finishWithThreat(this.currentThreat);
        return;
      }

      const currentDamage = this.getShieldDamage(currentItem);
      
      if (typeof currentDamage === 'number' && typeof this.lastShieldDamage === 'number') {
        if (currentDamage > this.lastShieldDamage) {
          logger.info(`ShieldDefense: shield damage detected (${this.lastShieldDamage} -> ${currentDamage}), triggering counter-attack`);
          this.lastShieldDamage = currentDamage;
          
          // Update threat and look
          try {
            const threat = this.reacquireThreat();
            this.currentThreat = threat || null;
            if (threat) {
              if (this.isCreeper(threat)) {
                logger.debug('ShieldDefense: creeper threat, continuing to block instead of attacking');
                this.pendingThreat = null;
                this.lookAtThreatSmooth(threat);
                return;
              }
              this.pendingThreat = threat;
              this.lookAtThreatSmooth(threat);
              this.finishWithThreat(threat);
            }
          } catch (err: any) {
            logger.debug(`ShieldDefense: error while acquiring threat after damage - ${err?.message || err}`);
          }
        }
      }
    }, 50);
  }

  private lookAtThreatSmooth(threat: any): void {
    if (!threat?.position || typeof this.bot?.lookAt !== 'function') {
      return;
    }

    try {
      // Look at entity center to avoid cardinal angle snapping from axis-aligned bounding box at melee range
      const entityHeight = threat.height || 1.8;
      const centerPos = new Vec3(
        threat.position.x,
        threat.position.y + entityHeight / 2,
        threat.position.z
      );
      this.bot.lookAt(centerPos, true);
    } catch (err: any) {
      logger.debug(`ShieldDefense: failed to look at threat - ${err?.message || err}`);
    }
  }

  private evaluateShouldContinue(): boolean {
    try {
      return this.shouldContinue();
    } catch (err: any) {
      logger.debug(`ShieldDefense: error evaluating continuation - ${err?.message || err}`);
      return false;
    }
  }

  private finishWithThreat(threat: any): void {
    if (this.finished) {
      return;
    }
    this.pendingThreat = threat;
    this.finished = true;
    this.clearTimers();
  }

  private isCreeper(entity: any): boolean {
    if (!entity) {
      return false;
    }
    const name = String(entity.name || entity.displayName || '').toLowerCase();
    return name === 'creeper';
  }

  private isShieldItem(item: any): boolean {
    if (!item) {
      return false;
    }
    const name = String(item.name || '').toLowerCase();
    return name === 'shield';
  }

  private getShieldDamage(item: any): number | null {
    if (!this.isShieldItem(item)) {
      return null;
    }
    if (typeof item.durabilityUsed === 'number') {
      return item.durabilityUsed;
    }
    if (typeof item.metadata === 'number' && item.metadata > 0) {
      return item.metadata;
    }
    if (item.nbt && typeof item.nbt === 'object') {
      try {
        const damage = (item.nbt?.value?.Damage as any)?.value;
        if (typeof damage === 'number') {
          return damage;
        }
      } catch (_) {
      }
    }
    return null;
  }

  private getItemInSlot(slot: number | null): any {
    if (slot == null) {
      return null;
    }
    const inventory: any = this.bot?.inventory;
    if (!inventory || !Array.isArray(inventory.slots)) {
      return null;
    }
    return inventory.slots[slot] ?? null;
  }

  private getOffhandSlot(): number | null {
    try {
      if (typeof this.bot?.getEquipmentDestSlot === 'function') {
        const slot = this.bot.getEquipmentDestSlot('off-hand');
        if (Number.isInteger(slot)) {
          return slot;
        }
      }
    } catch (err: any) {
      logger.debug(`ShieldDefense: unable to resolve off-hand slot - ${err?.message || err}`);
    }
    return null;
  }

}

export function createShieldDefenseState(bot: any, config: ShieldDefenseStateConfig): any {
  const holdDuration = Math.max(250, config.holdDurationMs ?? 5000);
  const shieldHold = new ShieldHoldState(bot, holdDuration, config.reacquireThreat, config.shouldContinue);
  const followAndAttack = createFollowAndAttackEntityState(bot, config.targets);
  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();

  let finishedNotified = false;
  const notifyFinished = (success: boolean): void => {
    if (finishedNotified) {
      return;
    }
    finishedNotified = true;
    if (typeof config.onFinished === 'function') {
      try {
        config.onFinished(success);
      } catch (err: any) {
        logger.debug(`ShieldDefense: error notifying finish - ${err?.message || err}`);
      }
    }
  };

  let cycleCount = 0;

  const enterToShield = new StateTransition({
    name: 'ShieldDefense: enter -> shield',
    parent: enter,
    child: shieldHold,
    shouldTransition: () => true,
    onTransition: () => {
      cycleCount = 0;
      finishedNotified = false;
      logger.info('ShieldDefense: activating shield behavior');
    }
  });

  const shieldToAttack = new StateTransition({
    name: 'ShieldDefense: shield -> attack',
    parent: shieldHold,
    child: followAndAttack,
    shouldTransition: () => {
      if (!shieldHold.isFinished()) {
        return false;
      }
      if (!shieldHold.getNextThreat()) {
        return false;
      }
      // Verify we should still continue the behavior before attacking
      try {
        if (!config.shouldContinue()) {
          logger.debug('ShieldDefense: conditions no longer met, clearing threat and exiting instead of attacking');
          shieldHold.consumeNextThreat();
          return false;
        }
      } catch (err: any) {
        logger.debug(`ShieldDefense: error checking shouldContinue in transition - ${err?.message || err}`);
        shieldHold.consumeNextThreat();
        return false;
      }
      return true;
    },
    onTransition: () => {
      const threat = shieldHold.consumeNextThreat();
      if (threat) {
        config.targets.entity = threat;
      }
      cycleCount += 1;
      logger.debug(`ShieldDefense: transitioning to attack (cycle ${cycleCount})`);
    }
  });

  const shieldToExit = new StateTransition({
    name: 'ShieldDefense: shield -> exit',
    parent: shieldHold,
    child: exit,
    shouldTransition: () => {
      const isFinished = shieldHold.isFinished();
      const nextThreat = shieldHold.getNextThreat();
      
      logger.debug(`ShieldDefense: shieldToExit check - isFinished=${isFinished}, nextThreat=${!!nextThreat}`);
      
      // Exit if no more threats after blocking
      if (isFinished && !nextThreat) {
        logger.info('ShieldDefense: shieldToExit firing - no threats');
        return true;
      }
      
      // Exit if conditions no longer met while shielding
      if (isFinished) {
        try {
          const shouldCont = config.shouldContinue();
          logger.debug(`ShieldDefense: shieldToExit check - shouldContinue=${shouldCont}`);
          if (!shouldCont) {
            logger.info('ShieldDefense: shieldToExit firing - conditions no longer met');
            return true;
          }
        } catch (err: any) {
          logger.debug(`ShieldDefense: error checking shouldContinue after shield - ${err?.message || err}`);
        }
      }
      
      return false;
    },
    onTransition: () => {
      shieldHold.consumeNextThreat();
      config.targets.entity = null;
      logger.info('ShieldDefense: exiting from shield state');
      notifyFinished(true);
    }
  });

  const followToShield = new StateTransition({
    name: 'ShieldDefense: attack -> shield',
    parent: followAndAttack,
    child: shieldHold,
    shouldTransition: () => {
      const finished = typeof followAndAttack.isFinished === 'function'
        ? followAndAttack.isFinished()
        : followAndAttack.isFinished === true;
      
      if (finished) {
        // Don't cycle back to shield if conditions are no longer met
        try {
          if (!config.shouldContinue()) {
            logger.debug('ShieldDefense: attack finished but conditions no longer met, not cycling back to shield');
            return false;
          }
        } catch (err: any) {
          logger.debug(`ShieldDefense: error checking shouldContinue after attack - ${err?.message || err}`);
          return false;
        }
        return true;
      }
      
      // Check for closer/higher priority threats while attacking
      try {
        const currentTarget = config.targets.entity;
        const newThreat = config.reacquireThreat();
        
        if (!newThreat || !currentTarget) {
          return false;
        }
        
        // If we found a different entity, compare priorities
        if (newThreat !== currentTarget) {
          const botPos = bot?.entity?.position;
          if (!botPos || typeof botPos.distanceTo !== 'function') {
            return false;
          }
          
          // Always interrupt for creepers (highest priority)
          const newIsCreeper = newThreat.name?.toLowerCase() === 'creeper';
          const currentIsCreeper = currentTarget.name?.toLowerCase() === 'creeper';
          
          if (newIsCreeper && !currentIsCreeper) {
            // Verify we should still continue before interrupting
            if (!config.shouldContinue()) {
              logger.debug('ShieldDefense: creeper detected but conditions no longer met, not interrupting');
              return false;
            }
            logger.info('ShieldDefense: interrupting attack - creeper threat detected');
            return true;
          }
          
          // Interrupt if new threat is significantly closer (more than 5 blocks closer)
          try {
            const currentDist = botPos.distanceTo(currentTarget.position);
            const newDist = botPos.distanceTo(newThreat.position);
            
            if (newDist < currentDist - 5) {
              // Verify we should still continue before interrupting
              if (!config.shouldContinue()) {
                logger.debug('ShieldDefense: closer threat detected but conditions no longer met, not interrupting');
                return false;
              }
              logger.info(`ShieldDefense: interrupting attack - closer threat detected (${newDist.toFixed(1)}m vs ${currentDist.toFixed(1)}m)`);
              return true;
            }
          } catch (err: any) {
            logger.debug(`ShieldDefense: error comparing threat distances - ${err?.message || err}`);
          }
        }
      } catch (err: any) {
        logger.debug(`ShieldDefense: error checking for closer threats - ${err?.message || err}`);
      }
      
      return false;
    },
    onTransition: () => {
      config.targets.entity = null;
      cycleCount += 1;
      
      // Safety valve: exit if cycling too many times
      if (cycleCount > 20) {
        logger.warn(`ShieldDefense: cycle limit reached (${cycleCount}), forcing exit to prevent memory leak`);
        shieldHold.cancel();
        notifyFinished(false);
        return;
      }
      
      logger.debug(`ShieldDefense: attack cycle complete, raising shield again (cycle ${cycleCount})`);
    }
  });

  const followToExit = new StateTransition({
    name: 'ShieldDefense: attack -> exit',
    parent: followAndAttack,
    child: exit,
    shouldTransition: () => {
      // Exit if conditions are no longer met while attacking
      try {
        if (!config.shouldContinue()) {
          logger.info('ShieldDefense: conditions no longer met during attack, exiting');
          return true;
        }
      } catch (err: any) {
        logger.debug(`ShieldDefense: error checking shouldContinue during attack - ${err?.message || err}`);
      }
      return false;
    },
    onTransition: () => {
      config.targets.entity = null;
      logger.info('ShieldDefense: exiting from attack state');
      notifyFinished(true);
    }
  });

  const transitions = [
    enterToShield,
    shieldToAttack,
    shieldToExit,
    followToExit,
    followToShield
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  stateMachine.stateName = 'shield_defense_state';

  const originalOnStateExited = stateMachine.onStateExited;
  stateMachine.onStateExited = function() {
    shieldHold.cancel();
    notifyFinished(true);
    if (typeof originalOnStateExited === 'function') {
      try {
        return originalOnStateExited.call(this);
      } catch (err: any) {
        logger.debug(`ShieldDefense: error in original onStateExited - ${err?.message || err}`);
      }
    }
    return undefined;
  };

  return stateMachine;
}


