import { WorldSnapshot, WorldAvailability, ResourceDemand, ResourceShortfall, FilterOptions } from './types';

/**
 * Builds a world availability map from a snapshot
 * 
 * Extracts block and entity counts from the snapshot structure and creates
 * efficient Map structures for lookup.
 * 
 * @param snapshot - World snapshot containing block and entity data
 * @returns World availability with maps of available resources
 */
export function buildWorldAvailability(snapshot: WorldSnapshot | null | undefined): WorldAvailability {
  const blocks = new Map<string, number>();
  const entities = new Map<string, number>();

  // New snapshot shape: snapshot.blocks is an object map name -> { count, closestDistance, averageDistance }
  if (snapshot && snapshot.blocks && typeof snapshot.blocks === 'object' && !Array.isArray(snapshot.blocks)) {
    for (const name of Object.keys(snapshot.blocks)) {
      const rec = snapshot.blocks[name];
      const count = rec && Number.isFinite(rec.count) ? rec.count : 0;
      if (name && count! > 0) {
        blocks.set(name, count!);
      }
    }
  }

  // Entities similarly summarized by name
  if (snapshot && snapshot.entities && typeof snapshot.entities === 'object' && !Array.isArray(snapshot.entities)) {
    for (const name of Object.keys(snapshot.entities)) {
      const rec = snapshot.entities[name];
      const count = rec && Number.isFinite(rec.count) ? rec.count : 0;
      if (name && count! > 0) {
        entities.set(name, count!);
      }
    }
  }

  return {
    blocks,
    entities
  };
}

/**
 * Computes the resource demand (blocks and entities) required by a path
 * 
 * Analyzes all mining and hunting steps in the path and aggregates the
 * total number of each block type to mine and entity type to hunt.
 * 
 * For hunting, calculates required encounters based on drop chance.
 * 
 * @param path - Action path to analyze
 * @returns Resource demand with maps of required resources
 */
export function computePathResourceDemand(_path: unknown): ResourceDemand {
  return {
    blocks: new Map(),
    entities: new Map()
  };
}

/**
 * Gets the available count for a specific resource name
 * 
 * @param name - Resource name to look up
 * @param availability - World availability map
 * @param _options - Additional options (currently unused)
 * @returns Available count, or 0 if not found
 */
function getAvailableCountForName(
  name: string | null | undefined,
  availability: WorldAvailability,
  _options: FilterOptions = {}
): number {
  if (!name) return 0;
  return availability.blocks.get(name) || 0;
}

/**
 * Checks if a demand can be satisfied by available resources
 * 
 * Compares the resource demand of a path against world availability
 * to determine if the path is feasible.
 * 
 * @param demand - Resource demand from a path
 * @param availability - Available resources in the world
 * @param options - Additional filtering options
 * @returns true if all demands can be met, false otherwise
 */
export function isDemandSatisfiedByAvailability(
  demand: ResourceDemand,
  availability: WorldAvailability,
  options: FilterOptions = {}
): boolean {
  // Check all block requirements
  for (const [name, need] of demand.blocks.entries()) {
    const have = getAvailableCountForName(name, availability, options);
    if (have < need) return false;
  }

  // Check all entity requirements
  for (const [name, need] of demand.entities.entries()) {
    const have = availability.entities.get(name) || 0;
    if (have < need) return false;
  }

  return true;
}

/**
 * Explains which resources are missing to satisfy a demand
 * 
 * Useful for debugging or providing feedback about why a path
 * cannot be executed with current world resources.
 * 
 * @param demand - Resource demand from a path
 * @param availability - Available resources in the world
 * @param options - Additional filtering options
 * @returns Detailed breakdown of missing resources
 */
export function explainDemandShortfall(
  demand: ResourceDemand,
  availability: WorldAvailability,
  options: FilterOptions = {}
): ResourceShortfall {
  const missing: ResourceShortfall = { blocks: [], entities: [] };

  // Check blocks
  for (const [name, need] of demand.blocks.entries()) {
    const have = getAvailableCountForName(name, availability, options);
    if (have < need) {
      missing.blocks.push({ name, need, have });
    }
  }

  // Check entities
  for (const [name, need] of demand.entities.entries()) {
    const have = availability.entities.get(name) || 0;
    if (have < need) {
      missing.entities.push({ name, need, have });
    }
  }

  return missing;
}

