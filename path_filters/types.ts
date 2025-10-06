/**
 * Type definitions for path filtering system
 */

/**
 * World snapshot containing information about available resources
 */
export interface WorldSnapshot {
  blocks?: {
    [blockName: string]: {
      count?: number;
      closestDistance?: number;
      averageDistance?: number;
    };
  };
  entities?: {
    [entityName: string]: {
      count?: number;
      closestDistance?: number;
      averageDistance?: number;
    };
  };
}

/**
 * World availability tracking counts of blocks and entities
 */
export interface WorldAvailability {
  blocks: Map<string, number>;
  entities: Map<string, number>;
}

/**
 * Resource demand from a path (blocks to mine, entities to hunt)
 */
export interface ResourceDemand {
  blocks: Map<string, number>;
  entities: Map<string, number>;
}

/**
 * Explanation of missing resources
 */
export interface ResourceShortfall {
  blocks: Array<{
    name: string;
    need: number;
    have: number;
  }>;
  entities: Array<{
    name: string;
    need: number;
    have: number;
  }>;
}

/**
 * Options for filtering operations
 */
export interface FilterOptions {
  [key: string]: any;
}

/**
 * Options for path generation and filtering
 */
export interface GenerateAndFilterOptions {
  inventory?: Record<string, number>;
  worldSnapshot?: WorldSnapshot;
  perGenerator?: number;
  log?: boolean;
  pruneWithWorld?: boolean;
  combineSimilarNodes?: boolean;
  config?: any;
}

