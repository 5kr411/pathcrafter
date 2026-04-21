/**
 * Minecraft data resolution utilities
 * 
 * Handles resolving Minecraft data from various input formats and ensures
 * required minecraft-data features files exist.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MinecraftData } from '../types';
import logger from '../../utils/logger';

let featuresFilesEnsured = false;

/**
 * Ensures that minecraft-data features files exist
 * 
 * This function creates missing features.json files that minecraft-data
 * requires to function properly. It searches multiple possible locations
 * for the minecraft-data package and creates the files if they don't exist.
 */
export function ensureMinecraftDataFeaturesFiles(): void {
  if (featuresFilesEnsured) return;
  featuresFilesEnsured = true;
  
  const projectRoot = path.join(__dirname, '..', '..');
  const candidates: string[] = [];

  candidates.push(path.join(projectRoot, 'node_modules', 'minecraft-data', 'minecraft-data', 'data'));
  candidates.push(path.join(projectRoot, 'node_modules', 'minecraft-data', 'data'));

  try {
    const resolved = require.resolve('minecraft-data/lib/supportsFeature.js');
    const modRoot = path.dirname(path.dirname(resolved));
    candidates.push(path.join(modRoot, '..', 'minecraft-data', 'data'));
    candidates.push(path.join(modRoot, 'minecraft-data', 'data'));
    candidates.push(path.join(modRoot, 'data'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
  } catch (err: any) {
    logger.debug(`mcDataResolver: require.resolve('minecraft-data/lib/supportsFeature.js') failed: ${err?.message || err}`);
  }

  const ensureAt = (baseDir: string, relPath: string): void => {
    const filePath = path.join(baseDir, relPath);
    const dir = path.dirname(filePath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`mcDataResolver: mkdirSync failed for ${dir}: ${err?.code || err?.message || err}`);
    }
    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`mcDataResolver: writeFileSync failed for ${filePath}: ${err?.code || err?.message || err}`);
    }
  };

  for (const base of candidates) {
    ensureAt(base, path.join('pc', 'common', 'features.json'));
    ensureAt(base, path.join('bedrock', 'common', 'features.json'));
  }
}

/**
 * Resolves Minecraft data from various input formats
 * 
 * @param ctx - Input context that can be:
 *   - A version string (e.g., '1.19.2')
 *   - A MinecraftData object with itemsByName, items, blocks, recipes
 *   - An object with a version property
 *   - null/undefined
 * @returns MinecraftData object or undefined if resolution fails
 * 
 * @example
 * ```typescript
 * // From version string
 * const mcData = resolveMcData('1.19.2');
 * 
 * // From existing MinecraftData object
 * const mcData = resolveMcData(existingMcData);
 * 
 * // From object with version
 * const mcData = resolveMcData({ version: '1.19.2' });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
export function resolveMcData(ctx: any): MinecraftData | undefined {
  if (!ctx) return undefined;
  ensureMinecraftDataFeaturesFiles();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  let minecraftData: any;
  try {
    minecraftData = require('minecraft-data');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
  } catch (err: any) {
    const isMissingFeatures = err && err.code === 'MODULE_NOT_FOUND' && /features\.json/.test(String(err.message || ''));
    if (isMissingFeatures) {
      ensureMinecraftDataFeaturesFiles();
      minecraftData = require('minecraft-data');
    } else {
      throw err;
    }
  }

  if (typeof ctx === 'string') return minecraftData(ctx);
  if (ctx.itemsByName && ctx.items && ctx.blocks && ctx.recipes) return ctx;
  if (typeof ctx === 'object' && ctx.version) return minecraftData(ctx.version);
  return undefined;
}
