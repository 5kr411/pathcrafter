import { ActionPath, ActionStep } from '../action_tree/types';

/**
 * Min-heap data structure for priority queue
 */
class MinHeap<T> {
  private data: T[];
  private compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
    this.data = [];
  }

  push(item: T): void {
    const a = this.data;
    a.push(item);
    let i = a.length - 1;

    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.compare(a[i], a[p]) >= 0) break;
      const t = a[i];
      a[i] = a[p];
      a[p] = t;
      i = p;
    }
  }

  pop(): T | undefined {
    const a = this.data;
    if (a.length === 0) return undefined;

    const top = a[0];
    const last = a.pop()!;

    if (a.length) {
      a[0] = last;
      let i = 0;

      while (true) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;

        if (l < a.length && this.compare(a[l], a[s]) < 0) s = l;
        if (r < a.length && this.compare(a[r], a[s]) < 0) s = r;

        if (s === i) break;

        const t = a[i];
        a[i] = a[s];
        a[s] = t;
        i = s;
      }
    }

    return top;
  }

  size(): number {
    return this.data.length;
  }
}

/**
 * Item with path for stream processing
 */
export interface PathItem {
  path: ActionPath;
  [key: string]: any;
}

/**
 * Configuration for priority streams
 */
export interface PriorityStreamConfig<T extends PathItem = PathItem> {
  getItemScore: (item: T) => number;
  getParentStepScore: (step: ActionStep | null) => number;
  finalizeItem: (path: ActionPath) => T;
}

/**
 * Stream function that yields path items
 */
export type StreamFunction<T extends PathItem = PathItem> = () => Generator<T, void, unknown>;

/**
 * Priority stream utilities for merging and combining paths
 */
export interface PriorityStreams<T extends PathItem = PathItem> {
  makeOrStream: (childStreams: StreamFunction<T>[]) => StreamFunction<T>;
  makeAndStream: (childStreams: StreamFunction<T>[], parentStepOrNull: ActionStep | null) => StreamFunction<T>;
}

/**
 * Creates priority stream utilities with the given configuration
 * 
 * Priority streams merge multiple generators while maintaining priority order:
 * - OR streams: Take best item from any child stream
 * - AND streams: Combine items from all child streams (Cartesian product)
 * 
 * @param cfg - Configuration for scoring, validation, and sanitization
 * @returns Priority stream utilities
 */
export function createPriorityStreams<T extends PathItem = PathItem>(cfg: PriorityStreamConfig<T>): PriorityStreams<T> {
  const getItemScore = typeof cfg.getItemScore === 'function' ? cfg.getItemScore : (_x: T) => 0;
  const getParentStepScore = typeof cfg.getParentStepScore === 'function' ? cfg.getParentStepScore : () => 0;
  const finalizeItem = typeof cfg.finalizeItem === 'function' ? cfg.finalizeItem : (p: ActionPath) => ({ path: p } as T);

  /**
   * Creates an OR stream that yields items from child streams in priority order
   * 
   * Takes the best (lowest score) item from any child stream at each step
   */
  function makeOrStream(childStreams: StreamFunction<T>[]): StreamFunction<T> {
    return function* () {
      const heap = new MinHeap<{ idx: number; gen: Generator<T>; item: T }>(
        (a, b) => getItemScore(a.item) - getItemScore(b.item)
      );

      const gens = childStreams.map((s) => s());

      gens.forEach((g, idx) => {
        const n = g.next();
        if (!n.done) heap.push({ idx, gen: g, item: n.value });
      });

      while (heap.size() > 0) {
        const entry = heap.pop()!;
        yield entry.item;

        const n = entry.gen.next();
        if (!n.done) heap.push({ idx: entry.idx, gen: entry.gen, item: n.value });
      }
    };
  }

  /**
   * Creates an AND stream that combines items from all child streams
   * 
   * Yields all combinations of items from child streams, ordered by total score.
   * Optionally appends a parent step to each combination.
   */
  function makeAndStream(childStreams: StreamFunction<T>[], parentStepOrNull: ActionStep | null): StreamFunction<T> {
    return function* () {
      interface StreamState {
        gen: Generator<T>;
        buf: T[];
        done: boolean;
      }

      const streams: StreamState[] = childStreams.map((s) => ({ gen: s(), buf: [], done: false }));

      function ensure(i: number, j: number): boolean {
        const st = streams[i];
        while (!st.done && st.buf.length <= j) {
          const n = st.gen.next();
          if (n.done) {
            st.done = true;
            break;
          }
          st.buf.push(n.value);
        }
        return st.buf.length > j;
      }

      // Ensure at least one item in each stream
      for (let i = 0; i < streams.length; i++) {
        if (!ensure(i, 0)) return;
      }

      const heap = new MinHeap<{ idx: number[]; score: number }>((a, b) => a.score - b.score);
      const visited = new Set<string>();
      const initIdx = new Array(streams.length).fill(0);

      function idxKey(idxArr: number[]): string {
        return idxArr.join(',');
      }

      function sumScore(idxArr: number[]): number {
        let s = 0;
        for (let i = 0; i < idxArr.length; i++) {
          s += getItemScore(streams[i].buf[idxArr[i]]);
        }
        s += getParentStepScore(parentStepOrNull);
        return s;
      }

      heap.push({ idx: initIdx, score: sumScore(initIdx) });
      visited.add(idxKey(initIdx));

      while (heap.size() > 0) {
        const node = heap.pop()!;
        const parts: ActionPath[] = [];

        for (let i = 0; i < node.idx.length; i++) {
          parts.push(streams[i].buf[node.idx[i]].path);
        }

        let combined = parts.flat();
        if (parentStepOrNull) {
          combined = combined.concat([parentStepOrNull]);
        }

        yield finalizeItem(combined);

        // Generate successor states
        for (let d = 0; d < streams.length; d++) {
          const nextIdx = node.idx.slice();
          nextIdx[d] += 1;

          if (!ensure(d, nextIdx[d])) continue;

          const k = idxKey(nextIdx);
          if (visited.has(k)) continue;

          visited.add(k);
          heap.push({ idx: nextIdx, score: sumScore(nextIdx) });
        }
      }
    };
  }

  return { makeOrStream, makeAndStream };
}

