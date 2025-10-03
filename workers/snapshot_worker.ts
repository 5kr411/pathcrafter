import { parentPort } from 'worker_threads';

const logger = require('../../utils/logger');

/**
 * Worker for processing world snapshot data in parallel
 * 
 * This worker receives batches of block/entity positions and names,
 * calculates distances, and aggregates statistics.
 */

interface SnapshotTask {
  type: 'process';
  id: string;
  blocks: Array<{ name: string; x: number; y: number; z: number }>;
  entities: Array<{ name: string; x: number; y: number; z: number }>;
  centerX: number;
  centerY: number;
  centerZ: number;
}

interface AggregationRecord {
  count: number;
  sumDist: number;
  closest: number;
}

if (!parentPort) {
  throw new Error('This module must be run as a worker thread');
}

/**
 * Calculate Euclidean distance between two 3D points
 */
function dist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

parentPort.on('message', (msg: SnapshotTask) => {
  if (!msg || msg.type !== 'process') return;

  const { id, blocks, entities, centerX, centerY, centerZ } = msg;

  try {
    const t0 = Date.now();
    logger.info(`SnapshotWorker: processing batch ${id} (${blocks.length} blocks, ${entities.length} entities)`);
    
    // Aggregate blocks
    const blockStats = new Map<string, AggregationRecord>();
    for (const block of blocks) {
      const d = dist(block.x, block.y, block.z, centerX, centerY, centerZ);
      const existing = blockStats.get(block.name);
      
      if (existing) {
        existing.count += 1;
        existing.sumDist += d;
        if (d < existing.closest) {
          existing.closest = d;
        }
      } else {
        blockStats.set(block.name, {
          count: 1,
          sumDist: d,
          closest: d
        });
      }
    }
    
    const t1 = Date.now();

    // Aggregate entities
    const entityStats = new Map<string, AggregationRecord>();
    for (const entity of entities) {
      const d = dist(entity.x, entity.y, entity.z, centerX, centerY, centerZ);
      const existing = entityStats.get(entity.name);
      
      if (existing) {
        existing.count += 1;
        existing.sumDist += d;
        if (d < existing.closest) {
          existing.closest = d;
        }
      } else {
        entityStats.set(entity.name, {
          count: 1,
          sumDist: d,
          closest: d
        });
      }
    }
    
    const t2 = Date.now();
    logger.info(`SnapshotWorker: batch ${id} processed in ${t2 - t0} ms (blocks:${t1-t0}ms, entities:${t2-t1}ms)`);

    // Convert Maps to plain objects for serialization
    const blockStatsObj: Record<string, AggregationRecord> = {};
    blockStats.forEach((value, key) => {
      blockStatsObj[key] = value;
    });

    const entityStatsObj: Record<string, AggregationRecord> = {};
    entityStats.forEach((value, key) => {
      entityStatsObj[key] = value;
    });

    parentPort!.postMessage({
      type: 'result',
      id,
      ok: true,
      blockStats: blockStatsObj,
      entityStats: entityStatsObj
    });
  } catch (err) {
    const errorMsg = (err && (err as Error).stack) ? (err as Error).stack : String(err);
    logger.info(`SnapshotWorker: batch ${id} ERROR - ${errorMsg}`);
    parentPort!.postMessage({
      type: 'result',
      id,
      ok: false,
      error: errorMsg
    });
  }
});

