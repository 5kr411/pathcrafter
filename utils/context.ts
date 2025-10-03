import { MinecraftData } from '../action_tree/types';

/**
 * Global context for minecraft data and planning state
 */

let lastMcData: MinecraftData | null = null;
let targetItemNameGlobal: string | null = null;
let lastSnapshotRadius: number | null = null;

export function setLastMcData(v: MinecraftData | null): void {
  lastMcData = v;
}

export function getLastMcData(): MinecraftData | null {
  return lastMcData;
}

export function setTargetItemNameGlobal(v: string | null): void {
  targetItemNameGlobal = v;
}

export function getTargetItemNameGlobal(): string | null {
  return targetItemNameGlobal;
}

export function setLastSnapshotRadius(v: number): void {
  if (Number.isFinite(v) && v > 0) {
    lastSnapshotRadius = Math.floor(v);
  }
}

export function getLastSnapshotRadius(): number | null {
  return lastSnapshotRadius;
}

