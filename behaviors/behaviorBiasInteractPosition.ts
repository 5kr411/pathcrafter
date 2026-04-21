import logger from '../utils/logger';
const Vec3 = require('vec3').Vec3;

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: Vec3Like) => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface Block {
  boundingBox?: string;
  type?: number;
  position?: Vec3Like;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface Bot {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  blockAt?: (pos: any) => Block | null;
  entity?: {
    position: Vec3Like;
  };
  version?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface Targets {
  position?: Vec3Like;
  blockPosition?: Vec3Like;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
  [key: string]: any;
}

const minecraftData = require('minecraft-data');

/**
 * Runs after BehaviorFindInteractPosition.
 * When the target block is enclosed (>=5 solid faces), re-selects
 * targets.position to prefer the closest reachable standing position,
 * so the bot stands near the block and drops land at its feet.
 */
export class BehaviorBiasInteractPosition {
  bot: Bot;
  targets: Targets;
  private _finished: boolean = false;
  private avoidBlockIds: Set<number>;

  stateName = 'biasInteractPosition';
  active = false;

  constructor(bot: Bot, targets: Targets) {
    this.bot = bot;
    this.targets = targets;

    const mcData = minecraftData(bot.version);
    this.avoidBlockIds = new Set<number>([
      mcData.blocksByName.lava.id,
      mcData.blocksByName.fire.id
    ]);
  }

  isFinished(): boolean {
    return this._finished;
  }

  onStateEntered(): void {
    this._finished = false;

    try {
      const blockPos = this.targets.blockPosition;
      if (!blockPos || !this.bot.blockAt) {
        this._finished = true;
        return;
      }

      const solidFaces = this.countSolidFaces(blockPos);
      if (solidFaces <= 4) {
        logger.debug(`BehaviorBiasInteractPosition: ${solidFaces} solid faces, no bias needed`);
        this._finished = true;
        return;
      }

      logger.info(`BehaviorBiasInteractPosition: ${solidFaces} solid faces, biasing to closest position`);
      this.reselectPosition(blockPos);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.error(`BehaviorBiasInteractPosition: error in onStateEntered: ${err.message}`);
    }

    this._finished = true;
  }

  onStateExited(): void {
    this._finished = false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  private vec3(x: number, y: number, z: number): any {
    return new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  private countSolidFaces(pos: Vec3Like): number {
    const offsets: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];

    let count = 0;
    for (const [dx, dy, dz] of offsets) {
      const neighbor = this.bot.blockAt!(this.vec3(pos.x + dx, pos.y + dy, pos.z + dz));
      if (neighbor && neighbor.boundingBox !== 'empty') {
        count++;
      }
    }
    return count;
  }

  private reselectPosition(blockPos: Vec3Like): void {
    const maxDist = 3;
    const botPos = this.bot.entity?.position;
    const bx = Math.floor(blockPos.x);
    const by = Math.floor(blockPos.y);
    const bz = Math.floor(blockPos.z);

    interface Candidate {
      x: number;
      y: number;
      z: number;
      cost: number;
    }

    const candidates: Candidate[] = [];

    for (let x = -maxDist; x <= maxDist; x++) {
      for (let y = -maxDist; y <= maxDist; y++) {
        for (let z = -maxDist; z <= maxDist; z++) {
          const cx = bx + x;
          const cy = by + y;
          const cz = bz + z;

          if (!this.isValidStandingPosition(cx, cy, cz)) continue;

          // Heavily weight proximity to block so the closest reachable position wins.
          const manhattan = Math.abs(x) + Math.abs(y) + Math.abs(z);
          let cost = manhattan * 10;

          // Small tiebreaker: prefer positions closer to the bot
          if (botPos) {
            const dx2 = cx - botPos.x;
            const dy2 = cy - botPos.y;
            const dz2 = cz - botPos.z;
            cost += Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);
          }

          candidates.push({ x: cx, y: cy, z: cz, cost });
        }
      }
    }

    if (candidates.length === 0) {
      logger.debug('BehaviorBiasInteractPosition: no valid candidates found, keeping original');
      return;
    }

    candidates.sort((a, b) => a.cost - b.cost);
    const best = candidates[0];

    this.targets.position = { x: best.x + 0.5, y: best.y, z: best.z + 0.5 };
    logger.debug(
      `BehaviorBiasInteractPosition: selected closest position (${best.x}, ${best.y}, ${best.z}) cost=${best.cost.toFixed(1)}`
    );
  }

  private isValidStandingPosition(x: number, y: number, z: number): boolean {
    const pos = this.vec3(x, y, z);
    const block = this.bot.blockAt!(pos);
    if (!block || block.boundingBox !== 'empty') return false;

    const under = this.bot.blockAt!(this.vec3(x, y - 1, z));
    if (!under || under.boundingBox !== 'block') return false;

    const over = this.bot.blockAt!(this.vec3(x, y + 1, z));
    if (over && over.boundingBox !== 'empty') return false;

    if (block.type !== undefined && this.avoidBlockIds.has(block.type)) return false;
    if (over && over.type !== undefined && this.avoidBlockIds.has(over.type)) return false;

    return true;
  }
}

export default BehaviorBiasInteractPosition;
