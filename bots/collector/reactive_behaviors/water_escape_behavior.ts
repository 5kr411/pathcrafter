import {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  StateBehavior
} from 'mineflayer-statemachine';

import { ReactiveBehavior, Bot } from './types';
import logger from '../../../utils/logger';
import { forceStopAllMovement } from '../../../utils/movement';
import { Vec3 } from 'vec3';
import { digBlockVerified } from '../../../utils/blockDigging';

// --- Constants ---

const WATER_ESCAPE_PRIORITY = 115;
const SUBMERGED_TRIGGER_SECONDS = 5;
const SWIM_UP_TIMEOUT_MS = 15000;
const TREAD_WATER_MS = 2000;
const SCAN_MAX_DISTANCE = 128;
const SWIM_TOWARD_PROGRESS_CHECK_MS = 3000;
const SWIM_TOWARD_MIN_PROGRESS = 2;
const SWIM_RANDOM_DURATION_MS = 60000;
const MAX_SCAN_RETRIES = 5;
const BOT_HITBOX_HALF_WIDTH = 0.3; // bot is 0.6 wide
const CENTER_TOLERANCE = 0.2;
const CENTER_TIMEOUT_MS = 2000;
const SWIM_UP_STALL_CHECK_MS = 1000;
const SWIM_UP_STALL_THRESHOLD = 0.3;

// --- Module-level state ---

let submergedSince: number | null = null;
let lastCheckPos: Vec3 | null = null;
const STUCK_THRESHOLD = 1.5; // must move more than this in 5s to count as making progress

// --- Shared helpers ---

function isSubmerged(bot: Bot): boolean {
  return ((bot as any).oxygenLevel ?? 20) < 20;
}

function isHeadInWater(bot: Bot): boolean {
  const pos = bot.entity?.position;
  if (!pos) return false;
  try {
    const headBlock = (bot as any).blockAt(new Vec3(pos.x, pos.y + 1.62, pos.z));
    if (!headBlock) return false;
    return headBlock.name === 'water';
  } catch {
    return false;
  }
}

function isOnSolidGround(bot: Bot): boolean {
  const pos = bot.entity?.position;
  if (!pos) return false;
  try {
    const below = (bot as any).blockAt(new Vec3(pos.x, pos.y - 0.5, pos.z));
    return below?.boundingBox === 'block';
  } catch {
    return false;
  }
}

function isOnDryLand(bot: Bot): boolean {
  return isOnSolidGround(bot) && !isHeadInWater(bot) && !isSubmerged(bot);
}

/**
 * Scan the 4 cardinal directions along the water surface.
 * Returns positions of first non-water solid block found per direction.
 */
function scanCardinalDirections(bot: Bot): Vec3[] {
  const pos = bot.entity?.position;
  if (!pos) return [];

  const surfaceY = Math.floor(pos.y);
  const directions: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const dirNames = ['north', 'south', 'west', 'east'];
  const results: Vec3[] = [];

  for (let i = 0; i < directions.length; i++) {
    const [dx, dz] = directions[i];
    for (let dist = 1; dist <= SCAN_MAX_DISTANCE; dist++) {
      const checkX = Math.floor(pos.x) + dx * dist;
      const checkZ = Math.floor(pos.z) + dz * dist;
      try {
        const block = (bot as any).blockAt(new Vec3(checkX, surfaceY, checkZ));
        if (!block) break;
        if (block.name !== 'water' && block.name !== 'air') {
          logger.debug(`WaterEscape: scan found land ${dirNames[i]} at (${checkX}, ${surfaceY}, ${checkZ}), dist=${dist}`);
          results.push(new Vec3(checkX, surfaceY + 1, checkZ));
          break;
        }
      } catch {
        break;
      }
    }
  }

  return results;
}

/**
 * Find solid blocks that overlap the bot's hitbox 1 block ahead in the
 * direction of travel. Checks 2 vertical levels (feet + head) and accounts
 * for the bot hitbox spanning up to 2 horizontal block columns.
 */
function findWallBlocks(bot: any, target: Vec3): any[] {
  const pos = bot.entity?.position;
  if (!pos) return [];

  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.01) return [];
  const nx = dx / len;
  const nz = dz / len;

  // Point 1 block ahead
  const aheadX = pos.x + nx * 1.0;
  const aheadZ = pos.z + nz * 1.0;

  // Block columns the hitbox overlaps at that point
  const minBX = Math.floor(aheadX - BOT_HITBOX_HALF_WIDTH);
  const maxBX = Math.floor(aheadX + BOT_HITBOX_HALF_WIDTH);
  const minBZ = Math.floor(aheadZ - BOT_HITBOX_HALF_WIDTH);
  const maxBZ = Math.floor(aheadZ + BOT_HITBOX_HALF_WIDTH);

  // Use target Y as surface reference — bot bobs up/down while treading water
  // so pos.y is unreliable. Check 2 blocks of clearance at surface level.
  const surfaceY = Math.floor(target.y);
  const seen = new Set<string>();
  const blocks: any[] = [];

  for (let bx = minBX; bx <= maxBX; bx++) {
    for (let bz = minBZ; bz <= maxBZ; bz++) {
      for (let y = surfaceY; y <= surfaceY + 1; y++) {
        const key = `${bx},${y},${bz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const block = bot.blockAt(new Vec3(bx, y, bz));
          if (block && block.boundingBox === 'block' && block.name !== 'water' && block.name !== 'bedrock') {
            blocks.push(block);
          }
        } catch (_) {}
      }
    }
  }

  return blocks;
}

// --- Shared targets interface ---

interface WaterEscapeTargets {
  landDirections: Vec3[];
  chosenTarget: Vec3 | null;
  scanRetries: number;
  wallBlocks: any[];
  ceilingBlock: any | null;
}

// --- State: SwimUp ---

class BehaviorSwimUp implements StateBehavior {
  public stateName = 'SwimUp';
  public active = false;
  private finished = false;
  private hitCeiling = false;
  private startTime = 0;
  private lastStallCheckTime = 0;
  private lastStallY = 0;

  constructor(
    private readonly bot: any,
    private readonly targets: WaterEscapeTargets
  ) {}

  onStateEntered(): void {
    this.finished = false;
    this.hitCeiling = false;
    this.active = true;
    this.startTime = Date.now();
    this.lastStallCheckTime = Date.now();
    this.lastStallY = this.bot.entity?.position?.y ?? 0;
    logger.info('WaterEscape: swimming up to surface');
    try { this.bot.setControlState('jump', true); } catch (_) {}
  }

  update(): void {
    if (this.finished || !this.active) return;

    if ((this.bot as any).oxygenLevel >= 20 || !isHeadInWater(this.bot)) {
      logger.debug('WaterEscape: surfaced');
      this.finished = true;
      return;
    }

    if (Date.now() - this.startTime > SWIM_UP_TIMEOUT_MS) {
      logger.debug('WaterEscape: swim up timed out');
      this.finished = true;
      return;
    }

    // Ceiling detection: if vertical progress stalls, check for solid block above head
    const now = Date.now();
    if (now - this.lastStallCheckTime >= SWIM_UP_STALL_CHECK_MS) {
      const currentY = this.bot.entity?.position?.y ?? 0;
      const yMoved = Math.abs(currentY - this.lastStallY);

      if (yMoved < SWIM_UP_STALL_THRESHOLD && isHeadInWater(this.bot)) {
        // Check block above head
        const headY = currentY + 1.62;
        const ceilingY = Math.ceil(headY);
        try {
          const pos = this.bot.entity.position;
          const ceilingBlock = this.bot.blockAt(new Vec3(Math.floor(pos.x), ceilingY, Math.floor(pos.z)));
          if (ceilingBlock && ceilingBlock.boundingBox === 'block' && ceilingBlock.name !== 'water' && ceilingBlock.name !== 'bedrock') {
            logger.info(`WaterEscape: ceiling detected (${ceilingBlock.name} at y=${ceilingY}), will mine through`);
            this.targets.ceilingBlock = ceilingBlock;
            this.hitCeiling = true;
            this.finished = true;
            return;
          }
        } catch (_) {}
      }

      this.lastStallCheckTime = now;
      this.lastStallY = currentY;
    }
  }

  onStateExited(): void {
    this.active = false;
    try { this.bot.setControlState('jump', false); } catch (_) {}
  }

  isFinished(): boolean { return this.finished; }
  didHitCeiling(): boolean { return this.hitCeiling; }
}

// --- State: TreadWater ---

class BehaviorTreadWater implements StateBehavior {
  public stateName = 'TreadWater';
  public active = false;
  private finished = false;
  private startTime = 0;

  constructor(private readonly bot: any) {}

  onStateEntered(): void {
    this.finished = false;
    this.active = true;
    this.startTime = Date.now();
    logger.debug('WaterEscape: treading water to stabilize');
    try { this.bot.setControlState('jump', true); } catch (_) {}
  }

  update(): void {
    if (this.finished || !this.active) return;
    if (Date.now() - this.startTime >= TREAD_WATER_MS) {
      this.finished = true;
    }
  }

  onStateExited(): void {
    this.active = false;
    try { this.bot.setControlState('jump', false); } catch (_) {}
  }

  isFinished(): boolean { return this.finished; }
}

// --- State: CenterOnBlock (reusable) ---

class BehaviorCenterOnBlock implements StateBehavior {
  public stateName = 'CenterOnBlock';
  public active = false;
  private finished = false;
  private startTime = 0;
  private targetX = 0;
  private targetZ = 0;

  constructor(private readonly bot: any) {}

  onStateEntered(): void {
    this.finished = false;
    this.active = true;
    this.startTime = Date.now();

    const pos = this.bot.entity?.position;
    if (!pos) { this.finished = true; return; }

    this.targetX = Math.floor(pos.x) + 0.5;
    this.targetZ = Math.floor(pos.z) + 0.5;

    logger.debug(`WaterEscape: centering on block (${this.targetX.toFixed(1)}, ${this.targetZ.toFixed(1)})`);
    try {
      this.bot.lookAt(new Vec3(this.targetX, pos.y, this.targetZ), true);
      this.bot.setControlState('jump', true);
    } catch (_) {}
  }

  update(): void {
    if (this.finished || !this.active) return;

    const pos = this.bot.entity?.position;
    if (!pos) { this.finished = true; return; }

    const dx = this.targetX - pos.x;
    const dz = this.targetZ - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < CENTER_TOLERANCE) {
      logger.debug('WaterEscape: centered on block');
      try { this.bot.setControlState('forward', false); } catch (_) {}
      this.finished = true;
      return;
    }

    if (Date.now() - this.startTime >= CENTER_TIMEOUT_MS) {
      logger.debug('WaterEscape: center timeout, proceeding');
      try { this.bot.setControlState('forward', false); } catch (_) {}
      this.finished = true;
      return;
    }

    // Walk toward center
    try {
      this.bot.lookAt(new Vec3(this.targetX, pos.y, this.targetZ), true);
      this.bot.setControlState('forward', true);
      this.bot.setControlState('jump', true);
    } catch (_) {}
  }

  onStateExited(): void {
    this.active = false;
    try {
      this.bot.setControlState('forward', false);
      this.bot.setControlState('jump', false);
    } catch (_) {}
  }

  isFinished(): boolean { return this.finished; }
}

// --- State: DigBlock (reusable) ---
// Digs a list of blocks using the shared digBlockVerified utility.
// Pulses jump between digs to maintain position underwater.

class BehaviorDigBlock implements StateBehavior {
  public stateName = 'DigBlock';
  public active = false;
  private finished = false;
  private blocksToDig: any[] = [];

  constructor(private readonly bot: any) {}

  setBlocks(blocks: any[]): void {
    this.blocksToDig = blocks.slice();
  }

  onStateEntered(): void {
    this.finished = false;
    this.active = true;
    try { this.bot.setControlState('forward', false); } catch (_) {}
    // Hold jump — keeps bot pressed against ceiling/wall, maintaining dig range
    try { this.bot.setControlState('jump', true); } catch (_) {}
    this.digAll();
  }

  private async digAll(): Promise<void> {
    for (const block of this.blocksToDig) {
      if (!this.active) break;
      if (!block || !block.position) continue;
      await digBlockVerified(this.bot, block.position);
    }

    this.blocksToDig = [];
    this.finished = true;
  }

  update(): void {}

  onStateExited(): void {
    this.active = false;
    try { this.bot.setControlState('jump', false); } catch (_) {}
  }

  isFinished(): boolean { return this.finished; }
}

// --- State: ScanForLand ---

class BehaviorScanForLand implements StateBehavior {
  public stateName = 'ScanForLand';
  public active = false;
  private finished = false;
  private foundLand = false;

  constructor(
    private readonly bot: any,
    private readonly targets: WaterEscapeTargets
  ) {}

  onStateEntered(): void {
    this.finished = false;
    this.foundLand = false;
    this.active = true;

    try { this.bot.setControlState('jump', true); } catch (_) {}

    const directions = scanCardinalDirections(this.bot);
    this.targets.landDirections = directions;

    if (directions.length > 0) {
      const chosen = directions[Math.floor(Math.random() * directions.length)];
      this.targets.chosenTarget = chosen;
      this.foundLand = true;
      logger.info(`WaterEscape: scan found ${directions.length} land direction(s), chose (${chosen.x}, ${chosen.y}, ${chosen.z})`);
    } else {
      this.targets.chosenTarget = null;
      this.targets.scanRetries++;
      logger.info(`WaterEscape: scan found no land (retry ${this.targets.scanRetries}/${MAX_SCAN_RETRIES})`);
    }

    this.finished = true;
  }

  update(): void {}

  onStateExited(): void {
    this.active = false;
    try { this.bot.setControlState('jump', false); } catch (_) {}
  }

  isFinished(): boolean { return this.finished; }
  didFindLand(): boolean { return this.foundLand; }
  retriesExhausted(): boolean { return this.targets.scanRetries >= MAX_SCAN_RETRIES; }
}

// --- State: SwimToward ---

class BehaviorSwimToward implements StateBehavior {
  public stateName = 'SwimToward';
  public active = false;
  private finished = false;
  private success = false;
  private hitWall = false;
  private lastProgressPos: Vec3 | null = null;
  private lastProgressTime = 0;

  constructor(
    private readonly bot: any,
    private readonly targets: WaterEscapeTargets
  ) {}

  onStateEntered(): void {
    this.finished = false;
    this.success = false;
    this.hitWall = false;
    this.active = true;
    this.lastProgressPos = this.bot.entity?.position?.clone() ?? null;
    this.lastProgressTime = Date.now();

    const target = this.targets.chosenTarget;
    if (!target) {
      this.finished = true;
      return;
    }

    logger.info(`WaterEscape: swimming toward land at (${target.x}, ${target.y}, ${target.z})`);
    try {
      this.bot.lookAt(target, true);
      this.bot.setControlState('forward', true);
      this.bot.setControlState('jump', true);
    } catch (_) {
      try { this.bot.setControlState('jump', true); } catch (_) {}
    }
  }

  update(): void {
    if (this.finished || !this.active) return;

    if (isOnDryLand(this.bot)) {
      logger.info('WaterEscape: reached dry land');
      this.finished = true;
      this.success = true;
      return;
    }

    // Keep looking at target
    const target = this.targets.chosenTarget;
    if (target) {
      try { this.bot.lookAt(target, true); } catch (_) {}
    }

    // Progress check
    if (!this.lastProgressPos || !this.bot.entity?.position) return;
    if (Date.now() - this.lastProgressTime < SWIM_TOWARD_PROGRESS_CHECK_MS) return;

    const dist = this.bot.entity.position.distanceTo(this.lastProgressPos);
    if (dist < SWIM_TOWARD_MIN_PROGRESS) {
      // Stuck — check for wall
      if (target) {
        const wall = findWallBlocks(this.bot, target);
        if (wall.length > 0) {
          logger.debug(`WaterEscape: hit wall (${wall.length} blocks), transitioning to mine`);
          this.targets.wallBlocks = wall;
          this.hitWall = true;
          this.finished = true;
          return;
        }
      }
      logger.debug(`WaterEscape: stuck (moved ${dist.toFixed(1)} blocks), no wall to mine`);
      this.finished = true;
      this.success = false;
      return;
    }

    // Making progress
    this.lastProgressPos = this.bot.entity.position.clone();
    this.lastProgressTime = Date.now();
  }

  onStateExited(): void {
    this.active = false;
    try {
      this.bot.setControlState('forward', false);
      this.bot.setControlState('jump', false);
    } catch (_) {}
  }

  isFinished(): boolean { return this.finished; }
  wasSuccessful(): boolean { return this.success; }
  didHitWall(): boolean { return this.hitWall; }
}


// --- State: SwimRandom ---

class BehaviorSwimRandom implements StateBehavior {
  public stateName = 'SwimRandom';
  public active = false;
  private finished = false;
  private startTime = 0;

  constructor(private readonly bot: any) {}

  onStateEntered(): void {
    this.finished = false;
    this.active = true;
    this.startTime = Date.now();

    const yaw = Math.random() * Math.PI * 2;
    logger.info(`WaterEscape: no land found, swimming random direction (yaw=${yaw.toFixed(2)}) for 60s`);
    try {
      const pos = this.bot.entity.position;
      this.bot.lookAt(new Vec3(
        pos.x + Math.cos(yaw) * 10,
        pos.y,
        pos.z + Math.sin(yaw) * 10
      ), true);
      this.bot.setControlState('forward', true);
      this.bot.setControlState('jump', true);
    } catch (_) {
      try { this.bot.setControlState('jump', true); } catch (_) {}
    }
  }

  update(): void {
    if (this.finished || !this.active) return;

    if (isOnDryLand(this.bot)) {
      logger.info('WaterEscape: found land while swimming randomly');
      this.finished = true;
      return;
    }

    if (Date.now() - this.startTime >= SWIM_RANDOM_DURATION_MS) {
      logger.debug('WaterEscape: random swim duration complete, will re-scan');
      this.finished = true;
    }
  }

  onStateExited(): void {
    this.active = false;
    try {
      this.bot.setControlState('forward', false);
      this.bot.setControlState('jump', false);
    } catch (_) {}
  }

  isFinished(): boolean { return this.finished; }
}

// --- State Machine Assembly ---

function createWaterEscapeState(bot: Bot): any {
  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();

  const targets: WaterEscapeTargets = {
    landDirections: [],
    chosenTarget: null,
    scanRetries: 0,
    wallBlocks: [],
    ceilingBlock: null
  };

  const swimUp = new BehaviorSwimUp(bot, targets);
  const centerForCeiling = new BehaviorCenterOnBlock(bot);
  const digCeiling = new BehaviorDigBlock(bot);
  const centerForScan = new BehaviorCenterOnBlock(bot);
  const treadWater = new BehaviorTreadWater(bot);
  const scanForLand = new BehaviorScanForLand(bot, targets);
  const swimToward = new BehaviorSwimToward(bot, targets);
  const digWall = new BehaviorDigBlock(bot);
  const swimRandom = new BehaviorSwimRandom(bot);
  const treadWaterRetry = new BehaviorTreadWater(bot);

  let reachedExit = false;
  let escaped = false;

  const transitions = [
    // Enter → SwimUp
    new StateTransition({
      parent: enter,
      child: swimUp,
      name: 'water-escape: enter -> swim-up',
      shouldTransition: () => true
    }),

    // SwimUp → CenterForCeiling (hit ceiling while rising)
    new StateTransition({
      parent: swimUp,
      child: centerForCeiling,
      name: 'water-escape: swim-up -> center-for-ceiling',
      shouldTransition: () => swimUp.isFinished() && swimUp.didHitCeiling()
    }),

    // CenterForCeiling → DigCeiling
    new StateTransition({
      parent: centerForCeiling,
      child: digCeiling,
      name: 'water-escape: center-for-ceiling -> dig-ceiling',
      shouldTransition: () => centerForCeiling.isFinished(),
      onTransition: () => {
        const block = targets.ceilingBlock;
        digCeiling.setBlocks(block ? [block] : []);
        targets.ceilingBlock = null;
      }
    }),

    // DigCeiling → SwimUp (loop — keep rising)
    new StateTransition({
      parent: digCeiling,
      child: swimUp,
      name: 'water-escape: dig-ceiling -> swim-up',
      shouldTransition: () => digCeiling.isFinished()
    }),

    // SwimUp → TreadWater (surfaced normally)
    new StateTransition({
      parent: swimUp,
      child: treadWater,
      name: 'water-escape: swim-up -> tread-water',
      shouldTransition: () => swimUp.isFinished() && !swimUp.didHitCeiling()
    }),

    // TreadWater → CenterForScan (center before scanning to reduce wall blocks)
    new StateTransition({
      parent: treadWater,
      child: centerForScan,
      name: 'water-escape: tread-water -> center-for-scan',
      shouldTransition: () => treadWater.isFinished()
    }),

    // CenterForScan → ScanForLand
    new StateTransition({
      parent: centerForScan,
      child: scanForLand,
      name: 'water-escape: center-for-scan -> scan',
      shouldTransition: () => centerForScan.isFinished()
    }),

    // ScanForLand → SwimToward (land found)
    new StateTransition({
      parent: scanForLand,
      child: swimToward,
      name: 'water-escape: scan -> swim-toward',
      shouldTransition: () => scanForLand.isFinished() && scanForLand.didFindLand()
    }),

    // ScanForLand → SwimRandom (no land, retries remain)
    new StateTransition({
      parent: scanForLand,
      child: swimRandom,
      name: 'water-escape: scan -> swim-random',
      shouldTransition: () => scanForLand.isFinished() && !scanForLand.didFindLand() && !scanForLand.retriesExhausted()
    }),

    // ScanForLand → Exit (no land, retries exhausted)
    new StateTransition({
      parent: scanForLand,
      child: exit,
      name: 'water-escape: scan -> exit (give up)',
      shouldTransition: () => scanForLand.isFinished() && !scanForLand.didFindLand() && scanForLand.retriesExhausted(),
      onTransition: () => {
        reachedExit = true;
        logger.warn(`WaterEscape: giving up after ${MAX_SCAN_RETRIES} scan retries`);
      }
    }),

    // SwimRandom → TreadWaterRetry
    new StateTransition({
      parent: swimRandom,
      child: treadWaterRetry,
      name: 'water-escape: swim-random -> tread-water-retry',
      shouldTransition: () => swimRandom.isFinished()
    }),

    // TreadWaterRetry → ScanForLand (retry loop)
    new StateTransition({
      parent: treadWaterRetry,
      child: scanForLand,
      name: 'water-escape: tread-water-retry -> scan',
      shouldTransition: () => treadWaterRetry.isFinished()
    }),

    // SwimToward → DigWall (hit wall)
    new StateTransition({
      parent: swimToward,
      child: digWall,
      name: 'water-escape: swim-toward -> dig-wall',
      shouldTransition: () => swimToward.isFinished() && swimToward.didHitWall(),
      onTransition: () => {
        digWall.setBlocks(targets.wallBlocks || []);
        targets.wallBlocks = [];
      }
    }),

    // DigWall → SwimToward (resume after mining)
    new StateTransition({
      parent: digWall,
      child: swimToward,
      name: 'water-escape: dig-wall -> swim-toward',
      shouldTransition: () => digWall.isFinished()
    }),

    // SwimToward → Exit (success or stuck with no wall)
    new StateTransition({
      parent: swimToward,
      child: exit,
      name: 'water-escape: swim-toward -> exit',
      shouldTransition: () => swimToward.isFinished() && !swimToward.didHitWall(),
      onTransition: () => {
        reachedExit = true;
        escaped = swimToward.wasSuccessful();
        logger.debug(`WaterEscape: swim-toward finished, success=${escaped}`);
      }
    })
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  (stateMachine as any).isFinished = () => reachedExit;
  (stateMachine as any).wasSuccessful = () => escaped;

  const allStates = [swimUp, centerForCeiling, digCeiling, centerForScan, treadWater, scanForLand, swimToward, digWall, swimRandom, treadWaterRetry];
  stateMachine.onStateExited = function () {
    logger.debug('WaterEscape: cleaning up on state exit');
    for (const state of allStates) {
      if (state && typeof state.onStateExited === 'function') {
        try { state.onStateExited(); } catch (_) {}
      }
    }
    try { (bot as any).clearControlStates?.(); } catch (_) {}
  };

  return stateMachine;
}

// --- Exported reactive behavior ---

export const waterEscapeBehavior: ReactiveBehavior = {
  priority: WATER_ESCAPE_PRIORITY,
  name: 'water_escape',

  shouldActivate: (bot: Bot): boolean => {
    const inWater = isSubmerged(bot) && isHeadInWater(bot);

    if (!inWater) {
      submergedSince = null;
      lastCheckPos = null;
      return false;
    }

    const now = Date.now();
    const pos = bot.entity?.position;

    if (submergedSince === null) {
      submergedSince = now;
      lastCheckPos = pos?.clone() ?? null;
      return false;
    }

    if ((now - submergedSince) < SUBMERGED_TRIGGER_SECONDS * 1000) {
      return false;
    }

    // Submerged long enough — check if stuck (not making progress)
    if (lastCheckPos && pos) {
      const moved = pos.distanceTo(lastCheckPos);
      if (moved > STUCK_THRESHOLD) {
        // Making progress underwater — don't interrupt, reset timer
        lastCheckPos = pos.clone();
        submergedSince = now;
        return false;
      }
    }

    return true;
  },

  createState: (bot: Bot) => {
    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : typeof bot?.chat === 'function'
        ? bot.chat.bind(bot)
        : null;

    submergedSince = null;
    forceStopAllMovement(bot, 'water escape start');

    if (sendChat) {
      try { sendChat('escaping water'); } catch (_) {}
    }

    logger.info('WaterEscape: activated');

    const stateMachine = createWaterEscapeState(bot);

    return {
      stateMachine,
      isFinished: () => (typeof (stateMachine as any).isFinished === 'function' ? (stateMachine as any).isFinished() : false),
      wasSuccessful: () => (typeof (stateMachine as any).wasSuccessful === 'function' ? (stateMachine as any).wasSuccessful() : true),
      onStop: (reason: string) => {
        if (!sendChat) return;
        const verb = reason === 'completed' ? 'escaped water'
          : reason === 'preempted' ? 'pausing water escape'
          : 'stopped water escape';
        try { sendChat(verb); } catch (_) {}
      }
    };
  }
};
