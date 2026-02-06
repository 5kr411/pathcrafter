const { BehaviorMoveTo } = require('mineflayer-statemachine');
const Vec3 = require('vec3').Vec3;
import logger from '../utils/logger';
import { getStuckDetectionWindowMs } from '../utils/movementConfig';
import { BehaviorMineBlock } from './behaviorMineBlock';
import { getToolRemainingUses } from '../utils/toolValidation';
import { ExecutionContext, signalToolIssue } from '../bots/collector/execution_context';

// Global tracking of which tools have been warned about
// This prevents spamming INFO logs across multiple state machine instances
export const globalDurabilityWarnings = new Map<string, number>();

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: Vec3Like) => number;
  clone?: () => Vec3Like;
  offset?: (x: number, y: number, z: number) => Vec3Like;
  floored?: () => Vec3Like;
  [key: string]: any;
}

interface Bot {
  entity?: {
    position: Vec3Like;
  };
  [key: string]: any;
}

interface PositionRecord {
  position: Vec3Like;
  timestamp: number;
}

export class BehaviorSmartMoveTo {
  bot: Bot;
  targets: any;
  private moveTo: any;
  private originalTarget: Vec3Like | null = null;
  private positionHistory: PositionRecord[] = [];
  private isStuck: boolean = false;
  private isUnsticking: boolean = false;
  private unstickTarget: Vec3Like | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private miningHitboxBlock: boolean = false;
  private mineBehavior: any = null;
  private lastDurabilityCheck: number = 0;
  private allowUnstick: boolean = true;

  constructor(bot: Bot, targets: any) {
    this.bot = bot;
    this.targets = targets;
    this.moveTo = new BehaviorMoveTo(bot, targets);
    
    this.onStateEntered = this.onStateEntered.bind(this);
    this.onStateExited = this.onStateExited.bind(this);
  }

  get distance(): number {
    return this.moveTo.distance;
  }

  set distance(value: number) {
    this.moveTo.distance = value;
  }

  isFinished(): boolean {
    return this.moveTo.isFinished();
  }

  distanceToTarget(): number {
    return this.moveTo.distanceToTarget();
  }

  onStateEntered(): void {
    logger.debug('BehaviorSmartMoveTo: onStateEntered called');
    this.originalTarget = this.targets.position ? this.clonePosition(this.targets.position) : null;
    this.positionHistory = [];
    this.isStuck = false;
    this.isUnsticking = false;
    this.unstickTarget = null;
    this.lastDurabilityCheck = 0;
    this.allowUnstick = this.targets?.disableSmartMoveUnstick !== true;

    if (this.targets) {
      if (typeof this.targets.smartMoveStuckCount === 'number') {
        this.targets.smartMoveStuckCount = 0;
      } else if ('smartMoveStuckCount' in this.targets) {
        delete this.targets.smartMoveStuckCount;
      }
      if ('lastSmartMoveStuck' in this.targets) {
        delete this.targets.lastSmartMoveStuck;
      }
    }

    this.recordCurrentPosition();
    
    this.checkInterval = setInterval(() => {
      this.checkIfStuck();
      this.checkToolDurability();
    }, 1000);
    
    logger.debug(`BehaviorSmartMoveTo: Started stuck detection interval for target at (${this.originalTarget?.x}, ${this.originalTarget?.y}, ${this.originalTarget?.z})`);

    if (this.moveTo.onStateEntered) {
      this.moveTo.onStateEntered();
    }
  }

  onStateExited(): void {
    logger.debug('BehaviorSmartMoveTo: onStateExited called');
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.debug('BehaviorSmartMoveTo: Cleared stuck detection interval');
    }

    if (this.mineBehavior && this.mineBehavior.onStateExited) {
      this.mineBehavior.onStateExited();
      this.mineBehavior = null;
    }

    this.positionHistory = [];
    this.isStuck = false;
    this.isUnsticking = false;
    this.miningHitboxBlock = false;
    this.lastDurabilityCheck = 0;
    this.allowUnstick = true;

    if (this.targets) {
      if ('smartMoveStuckCount' in this.targets) {
        delete this.targets.smartMoveStuckCount;
      }
      if ('lastSmartMoveStuck' in this.targets) {
        delete this.targets.lastSmartMoveStuck;
      }
    }

    if (this.moveTo.onStateExited) {
      this.moveTo.onStateExited();
    }
  }

  private clonePosition(pos: Vec3Like): Vec3Like {
    if (pos.clone) {
      return pos.clone();
    }
    return { x: pos.x, y: pos.y, z: pos.z };
  }

  private recordCurrentPosition(): void {
    if (!this.bot.entity?.position) return;

    const now = Date.now();
    const currentPos = this.clonePosition(this.bot.entity.position);

    this.positionHistory.push({
      position: currentPos,
      timestamp: now
    });

    const windowMs = getStuckDetectionWindowMs();
    const historyWindowMs = windowMs + 2000;
    const cutoff = now - historyWindowMs;
    this.positionHistory = this.positionHistory.filter(record => record.timestamp >= cutoff);
  }

  private getDistanceBetween(pos1: Vec3Like, pos2: Vec3Like): number {
    if (pos1.distanceTo) {
      return pos1.distanceTo(pos2);
    }
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    const dz = pos2.z - pos1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private isSolidMineableBlock(block: any): boolean {
    if (!block) return false;
    if (block.type === 0) return false;
    if (block.transparent) return false;
    if (block.boundingBox && block.boundingBox !== 'block') return false;
    const name = String(block.name || '').toLowerCase();
    if (name.includes('water') || name.includes('lava')) return false;
    return true;
  }

  private findBlockInHitbox(): any {
    if (!this.bot.entity?.position) return null;
    
    const botPos = this.bot.entity.position;
    const feetX = Math.floor(botPos.x);
    const feetY = Math.floor(botPos.y);
    const feetZ = Math.floor(botPos.z);
    
    const positions = [
      new Vec3(feetX, feetY, feetZ),
      new Vec3(feetX, feetY + 1, feetZ)
    ];

    for (const pos of positions) {
      try {
        if (!this.bot.blockAt) continue;
        
        const block = this.bot.blockAt(pos, false);
        if (!this.isSolidMineableBlock(block)) continue;
        
        if (this.bot.canDigBlock && !this.bot.canDigBlock(block)) continue;
        
        logger.debug(`BehaviorSmartMoveTo: Found block ${block.name} in hitbox at (${pos.x}, ${pos.y}, ${pos.z})`);
        return { block, position: pos };
      } catch (err: any) {
        logger.debug(`BehaviorSmartMoveTo: Error checking block in hitbox at (${pos.x}, ${pos.y}, ${pos.z}): ${err.message}`);
      }
    }
    
    return null;
  }

  private startMiningHitboxBlock(): void {
    const blockInfo = this.findBlockInHitbox();
    
    if (!blockInfo) {
      this.miningHitboxBlock = false;
      return;
    }

    logger.warn(`BehaviorSmartMoveTo: Found block in hitbox: ${blockInfo.block.name} at (${blockInfo.position.x}, ${blockInfo.position.y}, ${blockInfo.position.z}). Mining it...`);
    
    this.miningHitboxBlock = true;
    
    const mineTargets = { position: blockInfo.position };
    this.mineBehavior = new BehaviorMineBlock(this.bot, mineTargets);
    
    if (this.mineBehavior.onStateEntered) {
      this.mineBehavior.onStateEntered();
    }
  }

  private checkMiningProgress(): boolean {
    if (!this.miningHitboxBlock || !this.mineBehavior) return false;

    if (this.mineBehavior.isFinished) {
      logger.info('BehaviorSmartMoveTo: Finished mining block from hitbox');
      
      if (this.mineBehavior.onStateExited) {
        this.mineBehavior.onStateExited();
      }
      
      this.mineBehavior = null;
      this.miningHitboxBlock = false;
      
      const nextBlock = this.findBlockInHitbox();
      if (nextBlock) {
        logger.debug('BehaviorSmartMoveTo: Found another block in hitbox, mining it...');
        this.startMiningHitboxBlock();
        return true;
      }
      
      return false;
    }
    
    return true;
  }

  private checkIfStuck(): void {
    this.recordCurrentPosition();
    
    const currentPos = this.bot.entity?.position;
    if (!currentPos) return;
    
    if (this.miningHitboxBlock) {
      const stillMining = this.checkMiningProgress();
      if (!stillMining) {
        logger.info('BehaviorSmartMoveTo: Completed mining blocks from hitbox, resuming movement check');
        this.positionHistory = [];
      }
      return;
    }
    
    if (this.positionHistory.length > 0) {
      const oldestInHistory = this.positionHistory[0];
      const timespan = Date.now() - oldestInHistory.timestamp;
      const distance = this.getDistanceBetween(oldestInHistory.position, currentPos);
      logger.debug(`BehaviorSmartMoveTo: Check - ${this.positionHistory.length} records, ${(timespan/1000).toFixed(1)}s span, ${distance.toFixed(2)} blocks moved`);
    }

    if (this.isUnsticking) {
      if (this.moveTo.isFinished()) {
        logger.info('BehaviorSmartMoveTo: Unstick complete, retrying original target');
        this.isUnsticking = false;
        this.isStuck = false;
        this.positionHistory = [];
        
        if (this.originalTarget) {
          this.targets.position = this.originalTarget;
          this.moveTo = new BehaviorMoveTo(this.bot, this.targets);
          this.moveTo.distance = this.distance;
          if (this.moveTo.onStateEntered) {
            this.moveTo.onStateEntered();
          }
        }
        return;
      }
      
      const oldestRecord = this.positionHistory[0];
      const now = Date.now();
      const timespan = now - oldestRecord.timestamp;

      const windowMs = getStuckDetectionWindowMs();
      if (timespan >= windowMs) {
        const distanceMoved = this.getDistanceBetween(oldestRecord.position, currentPos);
        
        if (distanceMoved < 2) {
          logger.warn(`BehaviorSmartMoveTo: Still stuck while unsticking! Moved only ${distanceMoved.toFixed(2)} blocks.`);
          
          const blockInHitbox = this.findBlockInHitbox();
          if (blockInHitbox) {
            logger.info('BehaviorSmartMoveTo: Found blocks in hitbox while unsticking, mining them first');
            this.startMiningHitboxBlock();
          } else {
            this.positionHistory = [];
            this.initiateUnstick();
          }
        }
      }
      return;
    }

    if (this.moveTo.isFinished()) {
      return;
    }

    if (this.positionHistory.length < 2) {
      return;
    }

    const oldestRecord = this.positionHistory[0];
    const now = Date.now();
    const timespan = now - oldestRecord.timestamp;

    const windowMs = getStuckDetectionWindowMs();
    if (timespan < windowMs) {
      return;
    }

    const distanceMoved = this.getDistanceBetween(oldestRecord.position, currentPos);

    if (distanceMoved < 2 && !this.isStuck) {
      this.isStuck = true;
      logger.warn(`BehaviorSmartMoveTo: Bot is stuck! Moved only ${distanceMoved.toFixed(2)} blocks in ${(timespan/1000).toFixed(1)} seconds`);

      if (this.targets) {
        const now = Date.now();
        this.targets.lastSmartMoveStuck = now;
        const prevCount = Number(this.targets.smartMoveStuckCount) || 0;
        this.targets.smartMoveStuckCount = prevCount + 1;
      }

      const blockInHitbox = this.findBlockInHitbox();
      if (blockInHitbox) {
        logger.info('BehaviorSmartMoveTo: Found blocks in hitbox, mining them first');
        this.startMiningHitboxBlock();
      } else if (this.allowUnstick) {
        this.initiateUnstick();
      } else {
        logger.debug('BehaviorSmartMoveTo: Unstick suppressed for current targets');
      }
    }
  }

  private initiateUnstick(): void {
    if (!this.allowUnstick) {
      logger.debug('BehaviorSmartMoveTo: initiateUnstick called but unstick disabled');
      return;
    }
    if (!this.bot.entity?.position) return;

    const currentPos = this.bot.entity.position;
    const randomAngle = Math.random() * 2 * Math.PI;
    const unstickDistance = 5;

    const offsetX = unstickDistance * Math.cos(randomAngle);
    const offsetZ = unstickDistance * Math.sin(randomAngle);

    this.unstickTarget = {
      x: currentPos.x + offsetX,
      y: currentPos.y,
      z: currentPos.z + offsetZ
    };

    logger.info(`BehaviorSmartMoveTo: Moving to unstick position at (${this.unstickTarget.x.toFixed(1)}, ${this.unstickTarget.y.toFixed(1)}, ${this.unstickTarget.z.toFixed(1)})`);

    if (this.moveTo.onStateExited) {
      this.moveTo.onStateExited();
    }

    this.targets.position = this.unstickTarget;
    this.moveTo = new BehaviorMoveTo(this.bot, this.targets);
    this.moveTo.distance = this.distance;
    
    if (this.moveTo.onStateEntered) {
      this.moveTo.onStateEntered();
    }

    this.isUnsticking = true;
    this.isStuck = false;
    this.positionHistory = [];
  }

  private checkToolDurability(): void {
    const now = Date.now();
    if (now - this.lastDurabilityCheck < 500) {
      return;
    }
    this.lastDurabilityCheck = now;

    const executionContext = this.targets.executionContext as ExecutionContext | undefined;
    if (!executionContext || !executionContext.durabilityThreshold) {
      return;
    }

    const heldItem = this.bot.heldItem;
    if (!heldItem || !heldItem.name) {
      logger.debug(`BehaviorSmartMoveTo: durability check skipped - no held item`);
      return;
    }

    try {
      const remainingUses = getToolRemainingUses(this.bot, heldItem);
      
      if (!Number.isFinite(remainingUses) || remainingUses <= 0) {
        logger.debug(`BehaviorSmartMoveTo: durability check skipped - remainingUses=${remainingUses}`);
        return;
      }

      const itemData = this.bot.registry?.items?.[heldItem.type];
      const maxDurability = itemData?.maxDurability;
      
      if (!maxDurability || maxDurability <= 0) {
        logger.debug(`BehaviorSmartMoveTo: durability check skipped - maxDurability=${maxDurability}`);
        return;
      }

      const durabilityPct = remainingUses / maxDurability;
      logger.debug(`BehaviorSmartMoveTo: durability check - ${heldItem.name}: ${remainingUses}/${maxDurability} (${(durabilityPct * 100).toFixed(1)}%), threshold: ${(executionContext.durabilityThreshold * 100).toFixed(1)}%`);
      
      if (durabilityPct <= executionContext.durabilityThreshold) {
        // Use global map to track warnings across ALL instances
        const lastWarnedRemainingUses = globalDurabilityWarnings.get(heldItem.name);
        
        // Only log at INFO level if we haven't warned about this tool yet,
        // OR if the remaining uses have decreased significantly (tool broke and was replaced)
        if (lastWarnedRemainingUses === undefined || remainingUses > lastWarnedRemainingUses + 100) {
          const pctDisplay = (durabilityPct * 100).toFixed(1);
          const thresholdDisplay = (executionContext.durabilityThreshold * 100).toFixed(1);
          logger.info(
            `BehaviorSmartMoveTo: tool ${heldItem.name} low durability (${pctDisplay}% remaining, ${remainingUses}/${maxDurability} uses, threshold: ${thresholdDisplay}%)`
          );
          globalDurabilityWarnings.set(heldItem.name, remainingUses);
        }
        
        signalToolIssue(executionContext, {
          type: 'durability',
          toolName: heldItem.name,
          blockName: 'unknown',
          currentToolName: heldItem.name
        });
      }
    } catch (err: any) {
      logger.debug(`BehaviorSmartMoveTo: error checking durability: ${err.message || err}`);
    }
  }
}

export default BehaviorSmartMoveTo;
