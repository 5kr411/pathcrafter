import {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  StateBehavior
} from 'mineflayer-statemachine';

import { BehaviorPvpAttack } from './behaviorPvpAttack';
import { BehaviorWander } from './behaviorWander';
import logger from '../utils/logger';
import { Vec3 } from 'vec3';

const CREEPER_FLEE_WANDER_DISTANCE = 24;

const MAX_SHIELD_CYCLES = 5;

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
  private monitorInterval: NodeJS.Timeout | null = null;
  private pendingThreat: any = null;
  private currentThreat: any = null;
  private offHandSlot: number | null = null;
  private lastShieldDamage: number | null = null;
  private lastShieldItemType: number | null = null;
  private swingArmListener: ((entity: any) => void) | null = null;
  private shieldStartTime: number = 0;
  private _creeperTimedOut: boolean = false;
  private static readonly MAX_SHIELD_DURATION_MS = 15_000;

  constructor(
    private readonly bot: any,
    private readonly holdDurationMs: number,
    private readonly reacquireThreat: () => any | null,
    private readonly shouldContinue: () => boolean
  ) {}

  onStateEntered(): void {
    logger.debug('ShieldDefense: onStateEntered called, resetting state');
    this.finished = false;
    this._creeperTimedOut = false;
    this.pendingThreat = null;
    this.active = true;
    this.shieldStartTime = Date.now();

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
    this.lastShieldItemType = initialShieldItem?.type ?? null;

    logger.info(`ShieldDefense: initialized shield damage tracking - slot=${this.offHandSlot}, durability=${this.lastShieldDamage}/${initialShieldItem?.maxDurability || '?'}`)

    try {
      const threat = this.reacquireThreat();
      this.updateThreat(threat);
    } catch (err: any) {
      logger.debug(`ShieldDefense: error while acquiring initial threat - ${err?.message || err}`);
    }

    this.startMonitoring();
    this.startHoldTimer();

    this.swingArmListener = (entity: any) => {
      if (!this.active || this.finished) return;
      if (!this.currentThreat) return;
      // Only react to swings from the current threat
      if (entity !== this.currentThreat && entity?.id !== this.currentThreat?.id) return;
      // Creepers don't swing — they explode
      if (this.isCreeper(entity)) return;

      logger.info('ShieldDefense: melee attack detected via entitySwingArm, triggering counter-attack');
      this.finishWithThreat(this.currentThreat);
    };
    this.bot.on('entitySwingArm', this.swingArmListener);
  }

  onStateExited(): void {
    logger.debug('ShieldDefense: onStateExited called');
    this.cleanup(false);
  }

  isFinished(): boolean {
    return this.finished;
  }

  get creeperTimedOut(): boolean {
    return this._creeperTimedOut;
  }

  getCurrentThreat(): any | null {
    return this.currentThreat;
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
    if (this.swingArmListener) {
      try {
        this.bot.removeListener('entitySwingArm', this.swingArmListener);
      } catch (_) {}
      this.swingArmListener = null;
    }
    this.clearTimers();
    this.finished = false;
    this.lastShieldItemType = null;
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
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
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
      try {
        const threat = this.reacquireThreat();
        this.updateThreat(threat);
      } catch (err: any) {
        logger.debug(`ShieldDefense: error while acquiring threat in timeout - ${err?.message || err}`);
      }

      const continueShielding = this.evaluateShouldContinue();
      logger.debug(`ShieldDefense: hold timer fired - continueShielding=${continueShielding}, isCreeper=${this.isCreeper(this.currentThreat)}, pendingThreat=${!!this.pendingThreat}`);

      const elapsed = Date.now() - this.shieldStartTime;
      if (elapsed >= ShieldHoldState.MAX_SHIELD_DURATION_MS) {
        if (this.isCreeper(this.currentThreat)) {
          logger.info(`ShieldDefense: max shield duration reached (${(elapsed / 1000).toFixed(1)}s) against creeper, will wander away`);
          this._creeperTimedOut = true;
        } else {
          logger.info(`ShieldDefense: max shield duration reached (${(elapsed / 1000).toFixed(1)}s), exiting to allow flee`);
        }
        this.finished = true;
        return;
      }

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

  private startMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.monitorInterval = setInterval(() => {
      // Threat reacquisition
      let threat: any = null;
      try {
        threat = this.reacquireThreat();
      } catch (err: any) {
        logger.debug(`ShieldDefense: error while acquiring threat - ${err?.message || err}`);
      }

      this.updateThreat(threat);

      if (threat) {
        this.lookAtThreatSmooth(threat);
      }

      // Damage checking
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

      // Detect item replacement (death/recraft)
      const currentType = currentItem?.type ?? null;
      if (currentType !== this.lastShieldItemType ||
          (typeof currentDamage === 'number' && typeof this.lastShieldDamage === 'number' && currentDamage < this.lastShieldDamage)) {
        logger.info('ShieldDefense: shield item replaced, resetting durability tracking');
        this.lastShieldDamage = currentDamage;
        this.lastShieldItemType = currentType;
      }

      if (typeof currentDamage === 'number' && typeof this.lastShieldDamage === 'number') {
        if (currentDamage > this.lastShieldDamage) {
          logger.info(`ShieldDefense: shield damage detected (${this.lastShieldDamage} -> ${currentDamage}), triggering counter-attack`);
          this.lastShieldDamage = currentDamage;

          if (this.currentThreat) {
            if (this.isCreeper(this.currentThreat)) {
              logger.debug('ShieldDefense: creeper threat, continuing to block instead of attacking');
              this.lookAtThreatSmooth(this.currentThreat);
              return;
            }
            this.lookAtThreatSmooth(this.currentThreat);
            this.finishWithThreat(this.currentThreat);
          }
        }
      }
    }, 50);
  }

  private updateThreat(threat: any): void {
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
  }

  private lookAtThreatSmooth(threat: any): void {
    if (!threat?.position || typeof this.bot?.lookAt !== 'function') {
      return;
    }

    try {
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
  
  const pvpAttack = new BehaviorPvpAttack(bot, config.targets, {
    singleAttack: true,
    attackRange: config.targets.attackRange ?? 3.0,
    followRange: config.targets.followRange ?? 2.0,
    onStopped: (reason) => {
      logger.debug(`ShieldDefense: pvp counter-attack stopped - reason: ${reason}`);
    }
  });

  const creeperFleeWander = new BehaviorWander(bot, CREEPER_FLEE_WANDER_DISTANCE);

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
    child: pvpAttack,
    shouldTransition: () => {
      if (!shieldHold.isFinished()) {
        return false;
      }
      if (!shieldHold.getNextThreat()) {
        return false;
      }
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
      logger.debug(`ShieldDefense: transitioning to pvp counter-attack (cycle ${cycleCount})`);
    }
  });

  const shieldToWander = new StateTransition({
    name: 'ShieldDefense: shield -> creeper flee wander',
    parent: shieldHold,
    child: creeperFleeWander,
    shouldTransition: () => {
      return shieldHold.isFinished() && shieldHold.creeperTimedOut;
    },
    onTransition: () => {
      const threat = shieldHold.getCurrentThreat();
      const botPos = bot?.entity?.position;
      if (threat?.position && botPos) {
        const dx = threat.position.x - botPos.x;
        const dz = threat.position.z - botPos.z;
        const angleTowardCreeper = Math.atan2(dz, dx);
        creeperFleeWander.setAngleConstraint({ avoidAngle: angleTowardCreeper });
      } else {
        creeperFleeWander.setAngleConstraint(null);
      }
      shieldHold.consumeNextThreat();
      config.targets.entity = null;
      logger.info(`ShieldDefense: creeper standoff timeout, wandering ${CREEPER_FLEE_WANDER_DISTANCE} blocks to break standoff`);
    }
  });

  const wanderToExit = new StateTransition({
    name: 'ShieldDefense: creeper flee wander -> exit',
    parent: creeperFleeWander,
    child: exit,
    shouldTransition: () => creeperFleeWander.isFinished,
    onTransition: () => {
      logger.info('ShieldDefense: creeper flee wander complete, exiting');
      notifyFinished(true);
    }
  });

  let lastShieldExitLogTime = 0;
  const shieldToExit = new StateTransition({
    name: 'ShieldDefense: shield -> exit',
    parent: shieldHold,
    child: exit,
    shouldTransition: () => {
      const isFinished = shieldHold.isFinished();
      const nextThreat = shieldHold.getNextThreat();

      const now = Date.now();
      if (now - lastShieldExitLogTime >= 1000) {
        logger.debug(`ShieldDefense: shieldToExit check - isFinished=${isFinished}, nextThreat=${!!nextThreat}`);
        lastShieldExitLogTime = now;
      }
      
      if (isFinished && !nextThreat) {
        logger.info('ShieldDefense: shieldToExit firing - no threats');
        return true;
      }
      
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

  const attackToShield = new StateTransition({
    name: 'ShieldDefense: attack -> shield',
    parent: pvpAttack,
    child: shieldHold,
    shouldTransition: () => {
      if (!pvpAttack.isFinished()) {
        return false;
      }

      if (cycleCount >= MAX_SHIELD_CYCLES) {
        logger.info(`ShieldDefense: max cycles (${MAX_SHIELD_CYCLES}) reached, exiting instead of re-shielding`);
        return false;
      }

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
    },
    onTransition: () => {
      config.targets.entity = null;
      cycleCount += 1;

      logger.debug(`ShieldDefense: counter-attack complete, raising shield again (cycle ${cycleCount})`);
    }
  });

  const attackToExit = new StateTransition({
    name: 'ShieldDefense: attack -> exit',
    parent: pvpAttack,
    child: exit,
    shouldTransition: () => {
      if (!pvpAttack.isFinished()) {
        return false;
      }

      if (cycleCount >= MAX_SHIELD_CYCLES) {
        logger.info(`ShieldDefense: max cycles reached, forcing exit`);
        return true;
      }

      try {
        if (!config.shouldContinue()) {
          logger.info('ShieldDefense: conditions no longer met after attack, exiting');
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
    shieldToWander,
    shieldToAttack,
    shieldToExit,
    wanderToExit,
    attackToExit,
    attackToShield
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  stateMachine.stateName = 'shield_defense_state';

  const originalOnStateExited = stateMachine.onStateExited;
  stateMachine.onStateExited = function() {
    shieldHold.cancel();
    
    if (pvpAttack.active) {
      pvpAttack.forceStop();
    }
    
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
