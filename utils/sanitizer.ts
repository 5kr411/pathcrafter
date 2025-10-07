import { ActionPath, ActionStep } from '../action_tree/types';

/**
 * Options for path sanitization
 */
export interface SanitizeOptions {
  isPersistentName: (name: string) => boolean;
  isPathValid: (path: ActionPath) => boolean;
  getSmeltsPerUnitForFuel: (fuelName: string) => number;
}

/**
 * Determines what item is produced by an action step
 */
function produced(step: ActionStep | null | undefined): string | null {
  if (!step) return null;

  if (step.action === 'craft' && 'result' in step) {
    const result = (step as any).result;
    if (result && result.item) return result.item;
  }

  if (step.action === 'smelt' && 'result' in step) {
    const result = (step as any).result;
    if (result && result.item) return result.item;
  }

  if (step.action === 'mine' || step.action === 'hunt') {
    const targetItem = 'targetItem' in step ? (step as any).targetItem : null;
    return targetItem || step.what;
  }

  return null;
}

/**
 * Removes duplicate acquisitions of persistent items (tools, tables)
 * 
 * Since tools and crafting tables are reusable, we only need to acquire them once
 * 
 * @param path - Action path to deduplicate
 * @param isPersistentName - Function to check if an item is persistent
 * @returns Path with duplicate persistent acquisitions removed
 */
export function dedupePersistentAcquisitions(
  path: ActionPath,
  isPersistentName: (name: string) => boolean
): ActionPath {
  const have = new Map<string, number>();
  const keepForward = new Array(path.length).fill(true);

  function addHave(name: string | null): void {
    if (!name) return;
    have.set(name, (have.get(name) || 0) + 1);
  }

  function hasHave(name: string | null): boolean {
    return !!name && have.has(name) && have.get(name)! > 0;
  }

  for (let i = 0; i < path.length; i++) {
    const st = path[i];
    const prod = produced(st);

    if (prod && isPersistentName(prod)) {
      if (hasHave(prod)) {
        keepForward[i] = false;
        continue;
      }
      addHave(prod);
    }
  }

  return path.filter((_, idx) => keepForward[idx]);
}

/**
 * Sanitizes an action path by removing unnecessary steps
 * 
 * This function:
 * 1. Removes duplicate persistent item acquisitions (tools, tables)
 * 2. Removes steps that produce items that aren't needed
 * 3. Validates the resulting path
 * 
 * @param path - Action path to sanitize
 * @param opts - Sanitization options
 * @returns Sanitized path, or original path if sanitization fails
 */
export function sanitizePath(path: ActionPath, opts: SanitizeOptions): ActionPath {
  const isPersistentName = opts && typeof opts.isPersistentName === 'function' 
    ? opts.isPersistentName 
    : () => false;
  
  const isPathValid = opts && typeof opts.isPathValid === 'function' 
    ? opts.isPathValid 
    : null;
  
  const getSmeltsPerUnitForFuel = opts && typeof opts.getSmeltsPerUnitForFuel === 'function' 
    ? opts.getSmeltsPerUnitForFuel 
    : null;

  const filtered = dedupePersistentAcquisitions(path, isPersistentName);

  const need = new Map<string, number>();

  // Seed with final demand (what the path produces)
  (function seedFinalDemand() {
    for (let i = filtered.length - 1; i >= 0; i--) {
      const st = filtered[i];
      if (!st) continue;

      if (st.action === 'craft') {
        const result = 'result' in st ? (st as any).result : null;
        const out = result && result.item;
        const outCount = (result && result.perCraftCount ? result.perCraftCount : 1) * (st.count || 1);
        if (out && outCount > 0) {
          need.set(out, (need.get(out) || 0) + outCount);
          break;
        }
      }

      if (st.action === 'smelt') {
        const result = 'result' in st ? (st as any).result : null;
        const out = result && result.item;
        const outCount = (result && result.perSmelt ? result.perSmelt : 1) * (st.count || 1);
        if (out && outCount > 0) {
          need.set(out, (need.get(out) || 0) + outCount);
          break;
        }
      }

      if (st.action === 'mine' || st.action === 'hunt') {
        const targetItem = 'targetItem' in st ? (st as any).targetItem : null;
        const out = targetItem || st.what;
        const outCount = st.count || 1;
        if (out && outCount > 0) {
          need.set(out, (need.get(out) || 0) + outCount);
          break;
        }
      }
    }
  })();

  const keep = new Array(filtered.length).fill(false);

  function incNeed(name: string | null | undefined, count: number): void {
    if (!name || count <= 0) return;
    need.set(name, (need.get(name) || 0) + count);
  }

  function decNeed(name: string | null | undefined, count: number): void {
    if (!name || count <= 0) return;
    const cur = need.get(name) || 0;
    const next = cur - count;
    if (next > 0) {
      need.set(name, next);
    } else {
      need.delete(name);
    }
  }

  // Walk backwards to determine which steps to keep
  for (let i = filtered.length - 1; i >= 0; i--) {
    const st = filtered[i];
    if (!st) continue;

    if (st.action === 'smelt') {
      keep[i] = true;
      // Smelting requires a furnace to be present
      incNeed('furnace', 1);
      const input = 'input' in st ? (st as any).input : null;
      const inCount = (input && input.perSmelt ? input.perSmelt : 1) * (st.count || 1);
      incNeed(input && input.item, inCount);

      const fuel = 'fuel' in st ? (st as any).fuel : null;
      if (fuel) {
        if (getSmeltsPerUnitForFuel) {
          try {
            const perFuel = getSmeltsPerUnitForFuel(fuel) || 0;
            const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1);
            incNeed(fuel, fuelNeed);
          } catch (_) {
            incNeed(fuel, 1);
          }
        } else {
          incNeed(fuel, st.count || 1);
        }
      }
      continue;
    }

    if (st.action === 'craft') {
      // If this craft uses the crafting table, require one to be present earlier
      if (st.what.variants[0].value === 'table') {
        incNeed('crafting_table', 1);
      }

      const result = 'result' in st ? (st as any).result : null;
      const out = result && result.item;
      const outCount = (result && result.perCraftCount ? result.perCraftCount : 1) * (st.count || 1);
      const demand = out ? (need.get(out) || 0) : 0;

      if (demand <= 0 && !(out && isPersistentName(out))) {
        keep[i] = false;
        continue;
      }

      keep[i] = true;

      const ingredients = 'ingredients' in st && Array.isArray((st as any).ingredients) 
        ? (st as any).ingredients 
        : [];

      for (const ing of ingredients) {
        incNeed(ing && ing.item, (ing && ing.perCraftCount ? ing.perCraftCount : 0) * (st.count || 1));
      }

      if (out) decNeed(out, outCount);
      continue;
    }

    if (st.action === 'mine' || st.action === 'hunt') {
      const targetItem = 'targetItem' in st ? (st as any).targetItem : null;
      const out = targetItem || st.what;
      const demand = need.get(out) || 0;

      if (demand > 0) {
        keep[i] = true;
        decNeed(out, st.count || 1);
        const tool = 'tool' in st ? (st as any).tool : null;
        if (tool) incNeed(tool, 1);
      } else {
        keep[i] = false;
      }
      continue;
    }

    keep[i] = true;
  }

  const out = filtered.filter((_, idx) => keep[idx]);

  if (isPathValid) {
    try {
      if (!isPathValid(out)) return path;
    } catch (_) {
      return path;
    }
  }

  return out;
}

