/**
 * Type definitions for world snapshot system
 */

/**
 * 3D position in the world
 */
export interface Position {
  x: number;
  y: number;
  z: number;
}

/**
 * Vector3 (alternative position representation used by mineflayer)
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
  floored(): Vec3;
}

/**
 * Statistics for a resource type (block or entity)
 */
export interface ResourceStats {
  count: number;
  closestDistance: number | null;
  averageDistance: number;
}

/**
 * Complete world snapshot with aggregated resource data
 */
export interface WorldSnapshot {
  version: string;
  dimension: string;
  center: Position;
  radius: number;
  yMin: number;
  yMax: number;
  blocks: {
    [blockName: string]: ResourceStats;
  };
  entities: {
    [entityName: string]: ResourceStats;
  };
}

/**
 * Options for capturing a world snapshot
 */
export interface SnapshotOptions {
  /** Maximum Euclidean distance in blocks to scan (preferred) */
  radius?: number;
  /** Legacy option: converted to radius via radius = chunkRadius*16 + 15 */
  chunkRadius?: number;
  /** Include air blocks in the snapshot (default false) */
  includeAir?: boolean;
  /** Minimum Y coordinate to scan */
  yMin?: number;
  /** Maximum Y coordinate to scan */
  yMax?: number;
  /** Minecraft version override */
  version?: string;
  /** Minecraft data override */
  mcData?: any;
  /** Step size for async scanning (distance increment per iteration) */
  step?: number;
}

/**
 * Mineflayer bot entity
 */
export interface BotEntity {
  position: Vec3;
}

/**
 * Mineflayer game state
 */
export interface GameState {
  dimension?: string;
}

/**
 * Mineflayer block
 */
export interface Block {
  name: string;
  position?: Vec3;
}

/**
 * Mineflayer entity
 */
export interface Entity {
  position: Vec3;
  name?: string;
  type?: string;
  kind?: string;
}

/**
 * Simplified mineflayer bot interface
 */
export interface Bot {
  version?: string;
  entity?: BotEntity;
  game?: GameState;
  entities?: { [key: string]: Entity };
  findBlocks?: (options: {
    matching: (block: Block) => boolean;
    maxDistance: number;
    count: number;
  }) => Vec3[];
  blockAt?: (position: Vec3, extraInfos?: boolean) => Block | null;
}

/**
 * Incremental scan state for time-sliced world scanning
 */
export interface ScanState {
  bot: Bot;
  mc: any;
  includeAir: boolean;
  center: {
    cx: number;
    cy: number;
    cz: number;
  };
  maxRadius: number;
  yMin: number;
  yMax: number;
  step: number;
  r: number;
  seen: Set<string>;
  blockAgg: Map<string, {
    count: number;
    sumDist: number;
    closest: number;
  }>;
  done: boolean;
}

/**
 * Aggregation record for resources during scanning
 */
export interface AggregationRecord {
  count: number;
  sumDist: number;
  closest: number;
}

