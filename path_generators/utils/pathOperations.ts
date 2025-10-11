import { ActionPath } from '../../action_tree/types';

/**
 * Creates a deep clone of an action path
 * @param path - The action path to clone
 * @returns A new action path with cloned steps
 */
export function clonePath(path: ActionPath): ActionPath {
  return path.map(step => ({ ...step }));
}

/**
 * Serializes a path to a string for deduplication
 * @param path - The action path to serialize
 * @returns String representation of the path
 */
export function serializePath(path: ActionPath): string {
  try {
    return JSON.stringify(path);
  } catch (_) {
    return String(Math.random());
  }
}

/**
 * Removes duplicate paths from an array
 * @param paths - Array of action paths
 * @returns Array with duplicates removed
 */
export function dedupePaths(paths: ActionPath[]): ActionPath[] {
  const seen = new Set<string>();
  const out: ActionPath[] = [];

  for (const p of paths) {
    const key = serializePath(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }

  return out;
}

/**
 * Takes the first N items from an iterator
 * @param iter - The iterable to take from
 * @param n - Number of items to take
 * @returns Generator yielding up to n items
 */
export function* takeN<T>(iter: Iterable<T>, n: number): Generator<T, void, unknown> {
  let i = 0;
  for (const v of iter) {
    yield v;
    i += 1;
    if (i >= n) break;
  }
}

