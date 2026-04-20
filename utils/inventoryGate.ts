import { getEmptySlotCount } from './inventory';
import { buildInventoryManagementMachine } from '../bots/collector/reactive_behaviors/inventory_management_behavior';
import logger from './logger';

/**
 * Shared pre-gate: force a full inventory-management pass if we don't have
 * at least `minFreeSlots` empty slots. Bypasses the reactive behavior's
 * cooldown — callers (craft, collect-drop pickup) need fresh slots NOW,
 * regardless of when the last management pass ran.
 *
 * Resolves on completion. Never throws: machine errors and timeouts are
 * logged and swallowed so the caller can proceed with whatever slots it
 * has.
 */
export async function ensureInventoryRoom(bot: any, minFreeSlots: number): Promise<void> {
  if (getEmptySlotCount(bot) >= minFreeSlots) return;
  const machine = buildInventoryManagementMachine(bot);
  if (!machine) {
    logger.info('ensureInventoryRoom: no drop candidates, proceeding with current inventory');
    return;
  }
  try {
    await machine.run();
  } catch (err: any) {
    logger.warn(`ensureInventoryRoom: machine errored, proceeding - ${err?.message || err}`);
  }
}
