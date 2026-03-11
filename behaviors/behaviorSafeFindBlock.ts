import { getSafeFindRepeatThreshold, getLiquidAvoidanceDistance } from '../utils/config';
import { getLastSnapshotRadius } from '../utils/context';
import { findBlocksNonBlocking } from '../utils/findBlocks';
import { Vec3 } from 'vec3';

import logger from '../utils/logger';
const minecraftData = require('minecraft-data');

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
  blockAt: (pos: Vec3, extraInfos?: boolean) => Block | null;
  version?: string;
  entity?: {
    position?: Vec3 & { distanceTo?: (other: Vec3) => number };
  };
  canDigBlock?: (block: Block) => boolean;
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

  private _scanning: boolean;
  private _excluded: Set<string>;
  private _returnCounts: Map<string, number>;
  private _countThreshold: number;
  private _candidateList: Vec3[];
  private _candidateIndex: number;

  constructor(bot: Bot, targets: Targets) {
    this.stateName = 'safeFindBlock';
    this.active = false;
    this.bot = bot;
    this.targets = targets;

    this.blocks = [];
    this.maxDistance = 32;
    this.preventXRay = false;

    this._scanning = false;

    this._excluded = new Set<string>();
    this._returnCounts = new Map<string, number>();
    this._countThreshold = Math.max(
      1,
      Number(getSafeFindRepeatThreshold && getSafeFindRepeatThreshold()) || 3
    );
    this._candidateList = [];
    this._candidateIndex = 0;
  }

  clearExclusions(): void {
    this._excluded.clear();
    this._returnCounts.clear();
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

  isNearLiquid(pos: Vec3): boolean {
    try {
      const avoidanceRadius = getLiquidAvoidanceDistance();
      if (avoidanceRadius <= 0) return false;

      const mcData = minecraftData(this.bot.version);
      const liquidIds = new Set([
        mcData.blocksByName.water?.id,
        mcData.blocksByName.flowing_water?.id,
        mcData.blocksByName.lava?.id,
        mcData.blocksByName.flowing_lava?.id
      ].filter((id) => id !== undefined));

      for (let dx = -avoidanceRadius; dx <= avoidanceRadius; dx++) {
        for (let dy = -avoidanceRadius; dy <= avoidanceRadius; dy++) {
          for (let dz = -avoidanceRadius; dz <= avoidanceRadius; dz++) {
            const block = this.bot.blockAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz), false);
            if (block && liquidIds.has(block.type)) {
              return true;
            }
          }
        }
      }
      return false;
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
    // If we have remaining candidates from a previous scan, rotate instead of rescanning
    if (this.hasMoreCandidates()) {
      this._scanning = true;
      const popped = this.tryNextCandidate();
      if (!popped) {
        this.targets.position = undefined;
      }
      this._scanning = false;
      return;
    }

    // Fresh scan
    this._scanning = true;
    this._runScan().catch(() => {
      this.targets.position = undefined;
      this._scanning = false;
    });
  }

  private async _runScan(): Promise<void> {
    try {
      // Use dynamic radius from last snapshot, fallback to 32
      const radius = (() => {
        try {
          const r = Number(getLastSnapshotRadius && getLastSnapshotRadius());
          if (Number.isFinite(r) && r > 0) return r;
        } catch (_) {}
        return 32;
      })();

      const candidates = await findBlocksNonBlocking(this.bot as any, {
        matching: (block: any) => this.matchesBlock(block),
        maxDistance: radius,
        count: 64
      });

      const sorted = [...candidates].sort((a, b) => this._distanceSq(a) - this._distanceSq(b));
      const avoidanceRadius = getLiquidAvoidanceDistance();
      const nearLiquidPenalty = avoidanceRadius > 0 ? Math.max(avoidanceRadius * avoidanceRadius * 16, 256) : 0;

      type RankedCandidate = {
        pos: Vec3;
        score: number;
        distSq: number;
        nearLiquid: boolean;
      };

      const ranked: RankedCandidate[] = [];

      for (const p of sorted) {
        if (this.isExcluded(p)) continue;

        try {
          const block = this.bot.blockAt(p, false);
          if (!block) continue;
          if (typeof this.bot.canDigBlock === 'function' && !this.bot.canDigBlock(block)) continue;
        } catch (_) {
          continue;
        }

        const distSq = this._distanceSq(p);
        if (!Number.isFinite(distSq)) continue;

        const botY = this.bot.entity?.position?.y ?? 64;
        const absYDiff = Math.abs(p.y - botY);
        const heightPenalty = absYDiff > 2 ? absYDiff * absYDiff * 4 : 0;

        let nearLiquid = false;
        let penalty = heightPenalty;
        if (avoidanceRadius > 0) {
          nearLiquid = this.isNearLiquid(p);
          if (nearLiquid) {
            penalty += nearLiquidPenalty;
            try {
              logger.debug(
                `BehaviorSafeFindBlock: candidate near liquid at (${p.x}, ${p.y}, ${p.z}), distSq=${distSq.toFixed(2)}, penalty=${penalty}`
              );
            } catch (_) {
              /* ignore */
            }
          }
        }

        const score = distSq + penalty;
        ranked.push({ pos: p, score, distSq, nearLiquid });
      }

      // Sort by score ascending, ties broken by distSq
      ranked.sort((a, b) => a.score - b.score || a.distSq - b.distSq);

      this._candidateList = ranked.map(r => r.pos);
      this._candidateIndex = 0;

      if (ranked.length > 0) {
        const best = ranked[0];
        this.targets.position = best.pos;
        this._candidateIndex = 1;
        this._recordReturn(best.pos);
        if (best.nearLiquid) {
          try {
            logger.debug(
              `BehaviorSafeFindBlock: selected near-liquid block at (${best.pos.x}, ${best.pos.y}, ${best.pos.z}) (distSq=${best.distSq.toFixed(2)}, score=${best.score.toFixed(2)})`
            );
          } catch (_) {
            /* ignore */
          }
        }
      } else {
        this.targets.position = undefined;
      }
    } catch (err) {
      this.targets.position = undefined;
    } finally {
      this._scanning = false;
    }
  }

  isFinished(): boolean {
    return !this._scanning;
  }

  hasMoreCandidates(): boolean {
    return this._candidateIndex < this._candidateList.length;
  }

  tryNextCandidate(): boolean {
    if (this._candidateIndex >= this._candidateList.length) {
      return false;
    }
    const next = this._candidateList[this._candidateIndex];
    this._candidateIndex++;
    this.targets.position = next;
    this._recordReturn(next);
    return true;
  }

  private _distanceSq(pos: Vec3): number {
    try {
      const botPos = this.bot.entity?.position;
      if (!botPos) return Number.POSITIVE_INFINITY;

      if (typeof botPos.distanceTo === 'function') {
        const dist = botPos.distanceTo(pos as any);
        return Number.isFinite(dist) ? dist * dist : Number.POSITIVE_INFINITY;
      }

      const dx = pos.x - botPos.x;
      const dy = pos.y - botPos.y;
      const dz = pos.z - botPos.z;
      return dx * dx + dy * dy + dz * dz;
    } catch (_) {
      return Number.POSITIVE_INFINITY;
    }
  }
}

export default function createSafeFindBlock(bot: Bot, targets: Targets): BehaviorSafeFindBlock {
  return new BehaviorSafeFindBlock(bot, targets);
}

export function isPositionNearLiquid(bot: any, pos: { x: number; y: number; z: number }): boolean {
  try {
    const avoidanceRadius = getLiquidAvoidanceDistance();
    if (avoidanceRadius <= 0) return false;

    const mcData = minecraftData(bot.version);
    const liquidIds = new Set([
      mcData.blocksByName.water?.id,
      mcData.blocksByName.flowing_water?.id,
      mcData.blocksByName.lava?.id,
      mcData.blocksByName.flowing_lava?.id
    ].filter((id) => id !== undefined));

    for (let dx = -avoidanceRadius; dx <= avoidanceRadius; dx++) {
      for (let dy = -avoidanceRadius; dy <= avoidanceRadius; dy++) {
        for (let dz = -avoidanceRadius; dz <= avoidanceRadius; dz++) {
          const block = bot.blockAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz), false);
          if (block && liquidIds.has(block.type)) {
            return true;
          }
        }
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

export { BehaviorSafeFindBlock };

