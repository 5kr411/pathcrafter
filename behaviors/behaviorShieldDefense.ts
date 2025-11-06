import {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  StateBehavior
} from 'mineflayer-statemachine';

import createFollowAndAttackEntityState from './behaviorFollowAndAttackEntity';
import logger from '../utils/logger';
import { getNearestPointOnEntityBoundingBox } from './behaviorLookAt';
import { Vec3 } from 'vec3';

export interface ShieldDefenseStateConfig {
  targets: any;
  reacquireThreat: () => any | null;
  holdDurationMs?: number;
  shouldContinue: () => boolean;
}

class ShieldHoldState implements StateBehavior {
  public stateName = 'ShieldHold';
  public active = false;
  private finished = false;
  private holdTimer: NodeJS.Timeout | null = null;
  private threatInterval: NodeJS.Timeout | null = null;
  private pendingThreat: any = null;
  private currentThreat: any = null;
  private offHandSlot: number | null = null;
  private lastShieldDamage: number | null = null;
  private lastLookTime = 0;
  private readonly handleShieldSlotUpdate = (slot: number, oldItem: any, newItem: any) => {
    if (!this.active || this.finished) {
      return;
    }
    if (this.offHandSlot == null || slot !== this.offHandSlot) {
      return;
    }

    if (!this.isShieldItem(oldItem) && !this.isShieldItem(newItem)) {
      return;
    }

    const oldDamage = this.getShieldDamage(oldItem);
    const newDamage = this.getShieldDamage(newItem);
    const shieldBroken = this.isShieldItem(oldItem) && !this.isShieldItem(newItem);
    const damageIncreased = typeof oldDamage === 'number' && typeof newDamage === 'number' && newDamage > oldDamage;

    this.lastShieldDamage = newDamage ?? oldDamage ?? this.lastShieldDamage;

    if (!shieldBroken && !damageIncreased) {
      return;
    }

    this.refreshThreat(true);

    const currentIsCreeper = this.isCreeper(this.currentThreat);
    if (currentIsCreeper && !shieldBroken) {
      return;
    }

    const threat = this.pendingThreat || this.currentThreat;
    if (threat || shieldBroken) {
      this.finishWithThreat(threat);
    }
  };

  constructor(
    private readonly bot: any,
    private readonly holdDurationMs: number,
    private readonly reacquireThreat: () => any | null,
    private readonly shouldContinue: () => boolean
  ) {}

  onStateEntered(): void {
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
    this.lastShieldDamage = this.getShieldDamage(this.getItemInSlot(this.offHandSlot));

    try {
      const inventory: any = this.bot?.inventory;
      if (inventory && typeof inventory.on === 'function') {
        inventory.on('updateSlot', this.handleShieldSlotUpdate);
      }
    } catch (err: any) {
      logger.debug(`ShieldDefense: failed to attach shield listener - ${err?.message || err}`);
    }

    this.refreshThreat(true);
    this.startThreatPolling();
    this.startHoldTimer();
  }

  onStateExited(): void {
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
    }
    this.active = false;
    this.currentThreat = null;

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

    try {
      const inventory: any = this.bot?.inventory;
      if (inventory && typeof inventory.removeListener === 'function') {
        inventory.removeListener('updateSlot', this.handleShieldSlotUpdate);
      }
    } catch (err: any) {
      logger.debug(`ShieldDefense: failed to detach shield listener - ${err?.message || err}`);
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
  }

  private startHoldTimer(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }

    this.finished = false;
    const duration = Math.max(250, this.holdDurationMs);
    this.holdTimer = setTimeout(() => {
      this.refreshThreat(true);

      const continueShielding = this.evaluateShouldContinue();
      if (this.isCreeper(this.currentThreat)) {
        this.startHoldTimer();
        return;
      }

      if (!this.pendingThreat && continueShielding) {
        this.startHoldTimer();
        return;
      }

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
      this.refreshThreat(false);
    }, intervalMs);
  }

  private refreshThreat(forceLook: boolean): void {
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
      this.maybeLookAtThreat(threat, forceLook);
    } else {
      this.pendingThreat = null;
    }
  }

  private maybeLookAtThreat(threat: any, forceLook: boolean): void {
    if (!threat || !threat.position || typeof this.bot?.lookAt !== 'function') {
      return;
    }

    const now = Date.now();
    if (!forceLook && now - this.lastLookTime < 250) {
      return;
    }

    try {
      const lookTarget = this.getEntityAimPoint(threat);
      if (lookTarget) {
        this.bot.lookAt(lookTarget, true);
      }
      this.lastLookTime = now;
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
    if (typeof item.metadata === 'number') {
      return item.metadata;
    }
    if (typeof item.durabilityUsed === 'number') {
      return item.durabilityUsed;
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

  private getEntityAimPoint(entity: any): any {
    if (!entity || !entity.position || !this.bot?.entity?.position) {
      return entity?.position ?? null;
    }

    const botPos = this.bot.entity.position;
    const eyeHeight = typeof this.bot.entity.height === 'number' && this.bot.entity.height > 0 ? this.bot.entity.height : 1.62;
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
}

export function createShieldDefenseState(bot: any, config: ShieldDefenseStateConfig): any {
  const holdDuration = Math.max(250, config.holdDurationMs ?? 5000);
  const shieldHold = new ShieldHoldState(bot, holdDuration, config.reacquireThreat, config.shouldContinue);
  const followAndAttack = createFollowAndAttackEntityState(bot, config.targets);
  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();

  let cycleCount = 0;

  const enterToShield = new StateTransition({
    name: 'ShieldDefense: enter -> shield',
    parent: enter,
    child: shieldHold,
    shouldTransition: () => true,
    onTransition: () => {
      cycleCount = 0;
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
      return !!shieldHold.getNextThreat();
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
    shouldTransition: () => shieldHold.isFinished() && !shieldHold.getNextThreat(),
    onTransition: () => {
      shieldHold.consumeNextThreat();
      config.targets.entity = null;
      logger.info('ShieldDefense: no threats after blocking, exiting');
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
      return finished;
    },
    onTransition: () => {
      config.targets.entity = null;
      logger.debug('ShieldDefense: attack cycle complete, raising shield again');
    }
  });

  const transitions = [
    enterToShield,
    shieldToAttack,
    shieldToExit,
    followToShield
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  stateMachine.stateName = 'shield_defense_state';

  const originalOnStateExited = stateMachine.onStateExited;
  stateMachine.onStateExited = function() {
    shieldHold.cancel();
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


