import logger from './logger';
import { Vec3 } from 'vec3';

const DEFAULT_VERIFY_TIMEOUT_MS = 2000;
const DEFAULT_MAX_RETRIES = 3;

interface DigOptions {
  maxRetries?: number;
  verifyTimeoutMs?: number;
}

/**
 * Wait for a block position to become air/water (server confirmation).
 * Listens for blockUpdate event with a timeout.
 */
export function waitForBlockBreak(bot: any, pos: Vec3, timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS): Promise<boolean> {
  try {
    const block = bot.blockAt(pos);
    if (!block || block.name === 'air' || block.name === 'water') return Promise.resolve(true);
  } catch (_) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const eventName = `blockUpdate:(${pos.x}, ${pos.y}, ${pos.z})`;
    let done = false;
    const onUpdate = (_old: any, newBlock: any) => {
      if (done) return;
      if (!newBlock || newBlock.type === 0 || newBlock.name === 'water') {
        done = true;
        cleanup();
        resolve(true);
      }
    };
    const timeout = setTimeout(() => {
      if (!done) { done = true; cleanup(); resolve(false); }
    }, timeoutMs);
    const cleanup = () => {
      try { bot.world?.removeListener(eventName, onUpdate); } catch (_) {}
      clearTimeout(timeout);
    };
    try {
      bot.world?.on(eventName, onUpdate);
    } catch (_) {
      done = true; clearTimeout(timeout); resolve(false);
    }
  });
}

/**
 * Dig a block with look → equip → dig → verify broken → retry loop.
 * Returns true if the block was successfully broken.
 */
export async function digBlockVerified(bot: any, pos: Vec3, options: DigOptions = {}): Promise<boolean> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Re-fetch block — may have changed
    let block: any;
    try {
      block = bot.blockAt(pos);
      if (!block || block.name === 'air' || block.name === 'water') return true; // already gone
    } catch (_) {
      return false;
    }

    try {
      // Look at block center
      const center = new Vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
      await bot.lookAt(center, true);

      // Equip best tool
      if (bot.tool && typeof bot.tool.equipForBlock === 'function') {
        try {
          await bot.tool.equipForBlock(block, { requireHarvest: false });
        } catch (_) {}
      }

      logger.debug(`digBlockVerified: digging ${block.name} at (${pos.x}, ${pos.y}, ${pos.z}) (attempt ${attempt + 1})`);
      await bot.dig(block);
    } catch (err: any) {
      logger.debug(`digBlockVerified: dig error - ${err?.message || err}`);
    }

    // Verify block is actually broken
    const broken = await waitForBlockBreak(bot, pos, verifyTimeoutMs);
    if (broken) {
      logger.debug(`digBlockVerified: confirmed broken at (${pos.x}, ${pos.y}, ${pos.z})`);
      return true;
    }
    logger.debug(`digBlockVerified: block still present, retrying`);
  }

  return false;
}
