/**
 * Workstation lock utility
 *
 * Provides a global query for whether the bot is currently in a workstation
 * interaction phase (smelting, crafting with table). Food behaviors check this
 * to avoid interrupting workstation operations.
 */

type WorkstationPhaseProvider = () => boolean;

let provider: WorkstationPhaseProvider | null = null;

export function setWorkstationPhaseProvider(fn: WorkstationPhaseProvider | null): void {
  provider = fn;
}

export function isWorkstationLocked(): boolean {
  if (!provider) return false;
  try {
    return provider();
  } catch {
    return false;
  }
}
