const minecraftData = require('minecraft-data');
import { captureAdaptiveSnapshot } from '../../utils/adaptiveSnapshot';
import { setLastSnapshotRadius } from '../../utils/context';
import { plan as planner, _internals as plannerInternals } from '../../planner';
import logger from '../../utils/logger';
import { Bot, Snapshot, SnapshotOptions, AdaptiveSnapshotResult, Target } from './config';

function logDebug(msg: string, ...args: any[]): void {
  logger.debug(msg, ...args);
}

function logInfo(msg: string, ...args: any[]): void {
  logger.info(msg, ...args);
}

export async function captureSnapshotForTarget(
  bot: Bot,
  target: Target,
  inventory: Map<string, number>,
  snapshotRadii: number[],
  snapshotYHalf: number | null,
  pruneWithWorld: boolean,
  combineSimilarNodes: boolean
): Promise<AdaptiveSnapshotResult> {
  const version = bot.version || '1.20.1';

  const snapOpts: SnapshotOptions = { radii: snapshotRadii };
  if (Number.isFinite(snapshotYHalf)) {
    const y0 = Math.floor((bot.entity && bot.entity.position && bot.entity.position.y) || 64);
    snapOpts.yMin = y0 - snapshotYHalf!;
    snapOpts.yMax = y0 + snapshotYHalf!;
  }

  logDebug(`Collector: beginning adaptive snapshot with radii ${JSON.stringify(snapshotRadii)}`);
  const tSnapStart = Date.now();

  const pathValidator = async (snapshot: Snapshot): Promise<boolean> => {
    try {
      const mcData = minecraftData(version);
      const invObj: { [key: string]: number } = {};
      inventory.forEach((count, name) => {
        invObj[name] = count;
      });

      logDebug(`Collector: validator - starting validation for radius=${snapshot.radius}, pruneWithWorld=${pruneWithWorld}`);
      logDebug(`Collector: validator - inventory: ${JSON.stringify(invObj)}`);

      const tree = planner(mcData, target.item, target.count, {
        inventory,
        log: false,
        pruneWithWorld,
        combineSimilarNodes,
        worldSnapshot: snapshot as any
      });

      if (!tree) {
        logDebug(`Collector: validator - no tree generated for radius ${snapshot.radius}`);
        return false;
      }

      logDebug(`Collector: validator - tree built with ${tree.children.variants.length} root variants`);

      const { enumerateActionPathsGenerator } = plannerInternals;
      
      logDebug(`Collector: validator - using inventory format: Map with ${inventory.size} items for path generation`);
      
      const hasDiamond = invObj['diamond'] || 0;
      logDebug(`Collector: validator - inventory has ${hasDiamond} diamonds`);
      
      const iter = enumerateActionPathsGenerator(tree, { inventory: invObj });
      let pathCount = 0;
      for (const _path of iter) {
        pathCount++;
        const pathStr = _path.map((step: any) => step.action).join(' -> ');
        const hasMining = _path.some((step: any) => step.action === 'mine');
        logDebug(`Collector: validator - path #${pathCount}: ${pathStr} (length=${_path.length}, hasMining=${hasMining})`);
        
        if (hasDiamond >= 3) {
          logDebug(`Collector: validator - accepting craft-only path because inventory has diamonds`);
          return true;
        }
        
        if (hasMining) {
          logDebug(`Collector: validator - found valid path with mining at radius ${snapshot.radius}`);
          return true;
        }
        
        logDebug(`Collector: validator - rejecting craft-only path because inventory lacks diamonds`);
      }

      logDebug(`Collector: validator - no paths generated for radius ${snapshot.radius} (checked ${pathCount} paths)`);
      return false;
    } catch (err: any) {
      logDebug(`Collector: validator error - ${err.message}`);
      return false;
    }
  };

  const result: AdaptiveSnapshotResult = await captureAdaptiveSnapshot(bot, {
    ...snapOpts,
    validator: pathValidator,
    onProgress: (msg: string) => {
      logDebug(`Collector: ${msg}`);
    }
  });

  const snapshot = result.snapshot;
  const radiusUsed = result.radiusUsed;
  const attemptsCount = result.attemptsCount;

  try {
    setLastSnapshotRadius(radiusUsed);
  } catch (_) {}

  const dur = Date.now() - tSnapStart;
  logInfo(
    `Collector: snapshot captured in ${dur} ms (radius=${radiusUsed}, attempts=${attemptsCount}${
      Number.isFinite(snapOpts.yMin) ? `, yMin=${snapOpts.yMin}, yMax=${snapOpts.yMax}` : ''
    })`
  );

  if (snapshot && snapshot.blocks) {
    const blockTypes = Object.keys(snapshot.blocks).length;
    logDebug(`Collector: snapshot contains ${blockTypes} block types`);
  }
  if (snapshot && snapshot.entities) {
    const entityTypes = Object.keys(snapshot.entities).length;
    logDebug(`Collector: snapshot contains ${entityTypes} entity types`);
  }

  return result;
}

