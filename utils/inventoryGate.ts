import { getEmptySlotCount } from './inventory';
import type { InventoryManagementHandle } from '../bots/collector/reactive_behaviors/inventory_management_behavior';
import logger from './logger';

const DEFAULT_MIN_FREE_SLOTS = 2;

/**
 * Shared pre-gate: force a full inventory-management pass if we don't have
 * at least `minFreeSlots` empty slots. Bypasses the reactive behavior's
 * cooldown — callers (craft, collect-drop pickup) need fresh slots NOW,
 * regardless of when the last management pass ran.
 *
 * When `minFreeSlots` is omitted, the threshold is read from the per-bot
 * inventory-management handle (`preGateThreshold`). When no handle is
 * attached (e.g. in a test that didn't wire reactive behaviors), falls
 * back to `DEFAULT_MIN_FREE_SLOTS`.
 *
 * The handle itself lives at `bot.__reactiveBehaviors.inventoryManagement`,
 * attached in the bot wiring (`bots/collect_paths.ts` / `bots/agent_bot.ts`).
 * If no handle is present, the gate becomes a no-op rather than reaching
 * for a module singleton.
 *
 * Resolves on completion. Never throws: machine errors and timeouts are
 * logged and swallowed so the caller can proceed with whatever slots it
 * has.
 */
export async function ensureInventoryRoom(bot: any, minFreeSlots?: number): Promise<void> {
  const handle: InventoryManagementHandle | undefined = bot?.__reactiveBehaviors?.inventoryManagement;
  const effectiveMin = typeof minFreeSlots === 'number'
    ? minFreeSlots
    : (handle?.getConfig().preGateThreshold ?? DEFAULT_MIN_FREE_SLOTS);

  if (getEmptySlotCount(bot) >= effectiveMin) return;

  if (!handle) {
    // A missing handle indicates a wiring bug in a bot entrypoint —
    // log at warn so it's loud, not silent. The gate still returns
    // without throwing so callers can proceed with whatever slots the
    // bot currently has.
    logger.warn('ensureInventoryRoom: no inventory-management handle on bot, proceeding');
    return;
  }

  const machine = handle.buildMachine(bot);
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
