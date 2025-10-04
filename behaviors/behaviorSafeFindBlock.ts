import { getSafeFindRepeatThreshold } from '../utils/config';

import logger from '../utils/logger';

interface Vec3 {
  x: number;
  y: number;
  z: number;
  [key: string]: any;
}

interface Block {
  type: number;
  [key: string]: any;
}

interface Bot {
  findBlocks: (options: {
    matching: (block: Block) => boolean;
    maxDistance: number;
    count: number;
  }) => Vec3[];
  canSeeBlock: (block: Block) => boolean;
  [key: string]: any;
}

interface Targets {
  position?: Vec3;
  [key: string]: any;
}

function posKey(p: Vec3 | null | undefined): string {
  return p ? `${p.x},${p.y},${p.z}` : 'nil';
}

class BehaviorSafeFindBlock {
  stateName: string;
  active: boolean;
  bot: Bot;
  targets: Targets;
  blocks: number[];
  maxDistance: number;
  preventXRay: boolean;

  private _excluded: Set<string>;
  private _returnCounts: Map<string, number>;
  private _countThreshold: number;

  constructor(bot: Bot, targets: Targets) {
    this.stateName = 'safeFindBlock';
    this.active = false;
    this.bot = bot;
    this.targets = targets;

    this.blocks = [];
    this.maxDistance = 32;
    this.preventXRay = false;

    this._excluded = new Set<string>();
    this._returnCounts = new Map<string, number>();
    this._countThreshold = Math.max(
      1,
      Number(getSafeFindRepeatThreshold && getSafeFindRepeatThreshold()) || 3
    );
  }

  addExcludedPosition(pos: Vec3 | null | undefined): void {
    try {
      if (!pos) return;
      const key = posKey(pos);
      this._excluded.add(key);
    } catch (_) {
      // Ignore errors
    }
  }

  isExcluded(pos: Vec3 | null | undefined): boolean {
    try {
      const key = posKey(pos);
      if (this._excluded.has(key)) return true;
      const cnt = this._returnCounts.get(key) || 0;
      return cnt >= this._countThreshold;
    } catch (_) {
      return false;
    }
  }

  matchesBlock(block: Block): boolean {
    try {
      if (!this.blocks || this.blocks.length === 0) return false;
      if (!this.blocks.includes(block.type)) return false;
      if (this.preventXRay) {
        if (!this.bot.canSeeBlock(block)) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  private _recordReturn(pos: Vec3): void {
    try {
      const key = posKey(pos);
      const next = (this._returnCounts.get(key) || 0) + 1;
      this._returnCounts.set(key, next);
      if (next >= this._countThreshold && !this._excluded.has(key)) {
        this._excluded.add(key);
        try {
          logger.info('BehaviorSafeFindBlock: excluding position after repeats', pos);
        } catch (_) {
          // Ignore logging errors
        }
      }
    } catch (_) {
      // Ignore errors
    }
  }

  onStateEntered(): void {
    try {
      const candidates =
        this.bot.findBlocks({
          matching: (block: Block) => this.matchesBlock(block),
          maxDistance: this.maxDistance,
          count: 64
        }) || [];
      let chosen: Vec3 | undefined = undefined;
      for (const p of candidates) {
        if (!this.isExcluded(p)) {
          chosen = p;
          break;
        }
      }
      if (chosen) {
        this.targets.position = chosen;
        this._recordReturn(chosen);
      } else {
        this.targets.position = undefined;
      }
    } catch (err) {
      this.targets.position = undefined;
    }
  }

  isFinished(): boolean {
    return true;
  }
}

export default function createSafeFindBlock(bot: Bot, targets: Targets): BehaviorSafeFindBlock {
  return new BehaviorSafeFindBlock(bot, targets);
}

export { BehaviorSafeFindBlock };

