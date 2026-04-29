/**
 * Regression tests for: planner emitted `smelt(beef -> cooked_beef)` paths
 * with no upstream step that produces beef.
 *
 * Root cause: when world pruning removes the hunt branch (no cows in snapshot),
 * the smelt-input dependency root ends up with zero children. `pruneDeadBranches`
 * removes that empty root from the smelt's children, but the smelt node itself
 * survives because `isNodeViable` treats smelt as a leaf. Path enumeration then
 * emits the smelt step as if the input came from nowhere.
 *
 * Fix: drop a smelt variant whose input cannot be sourced (count > 0 and no
 * children, with nothing in inventory). When no smelt variant survives, the
 * smelt group is omitted entirely.
 */
import plan, { _internals } from '../../planner';
import type { ActionStep } from '../../action_tree/types';

const mcData = _internals.resolveMcData('1.20.1');
const { enumerateActionPathsGenerator, enumerateShortestPathsGenerator } = _internals;

const BARREN_SNAPSHOT = {
  version: '1.20.1',
  dimension: 'overworld',
  center: { x: 0, y: 64, z: 0 },
  radius: 32,
  yMin: -64,
  yMax: 320,
  blocks: {
    oak_log: { count: 50, closestDistance: 5, averageDistance: 8 },
    crafting_table: { count: 1, closestDistance: 2, averageDistance: 2 },
    stone: { count: 200, closestDistance: 6, averageDistance: 10 },
    coal_ore: { count: 10, closestDistance: 12, averageDistance: 18 }
  },
  entities: {} // No animals — beef/porkchop/mutton/chicken are unobtainable
};

function pathSummary(path: ActionStep[]): string {
  return path.map(s => {
    const what = s.what?.variants?.[0]?.value || '?';
    const result = (s.result?.variants?.[0]?.value as { item?: string } | undefined)?.item;
    const input = (s.input?.variants?.[0]?.value as { item?: string } | undefined)?.item;
    if (s.action === 'smelt') return `smelt(${input}->${result})`;
    if (s.action === 'hunt') return `hunt(${what})`;
    if (s.action === 'mine') {
      const ti = s.targetItem?.variants?.[0]?.value;
      return `mine(${what}${ti ? '->' + ti : ''})`;
    }
    if (s.action === 'craft') return `craft(${result})`;
    return s.action;
  }).join(' -> ');
}

function pathHasStepProducing(path: ActionStep[], item: string, beforeIndex: number): boolean {
  for (let i = 0; i < beforeIndex; i++) {
    const s = path[i];
    if (s.action === 'hunt') {
      const ti = s.targetItem?.variants;
      const what = s.what?.variants;
      if (ti?.some(v => v.value === item)) return true;
      if (what?.some(v => v.value === item)) return true;
    }
    if (s.action === 'mine') {
      const ti = s.targetItem?.variants;
      if (ti?.some(v => v.value === item)) return true;
    }
    if (s.action === 'craft') {
      const result = (s.result?.variants?.[0]?.value as { item?: string } | undefined)?.item;
      if (result === item) return true;
    }
    if (s.action === 'smelt') {
      const result = (s.result?.variants?.[0]?.value as { item?: string } | undefined)?.item;
      if (result === item) return true;
    }
  }
  return false;
}

describe('unit: smelt input sourcing — planner must not emit smelt without producing input', () => {
  describe.each([
    ['cooked_beef', 'beef'],
    ['cooked_porkchop', 'porkchop'],
    ['cooked_mutton', 'mutton'],
    ['cooked_chicken', 'chicken']
  ])('%s (smelt input: %s) in barren world (no animals)', (target, input) => {
    test('no enumerated path emits smelt without first producing the raw input', () => {
      const tree = plan(mcData, target, 4, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot: BARREN_SNAPSHOT,
        combineSimilarNodes: true
      });

      let pathsChecked = 0;
      const offenders: string[] = [];
      for (const path of enumerateActionPathsGenerator(tree, { inventory: new Map() })) {
        for (let i = 0; i < path.length; i++) {
          const step = path[i];
          if (step.action !== 'smelt') continue;
          const inputItem = (step.input?.variants?.[0]?.value as { item?: string } | undefined)?.item;
          if (inputItem !== input) continue;
          if (!pathHasStepProducing(path, input, i)) {
            offenders.push(pathSummary(path));
          }
        }
        pathsChecked += 1;
        if (pathsChecked >= 20) break;
      }

      expect(offenders).toEqual([]);
    });

    test('top-level smelt branch is not added when input cannot be sourced', () => {
      const tree = plan(mcData, target, 4, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot: BARREN_SNAPSHOT,
        combineSimilarNodes: true
      });

      // cooked_X has only a smelt route in vanilla recipes. With the input
      // unsourceable, the tree should not contain a smelt branch (and the
      // tree therefore has no viable acquisition path).
      const smeltChildren = tree.children.variants.filter(c => c.value.action === 'smelt');
      expect(smeltChildren).toEqual([]);
    });
  });

  describe('iron_ingot (regression — smelt path must still work when input is sourceable)', () => {
    test('paths include mine(iron_ore) before smelt(raw_iron->iron_ingot)', () => {
      const ironSnapshot = {
        ...BARREN_SNAPSHOT,
        blocks: {
          ...BARREN_SNAPSHOT.blocks,
          iron_ore: { count: 5, closestDistance: 10, averageDistance: 15 }
        }
      };

      const tree = plan(mcData, 'iron_ingot', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot: ironSnapshot,
        combineSimilarNodes: true
      });

      let found = false;
      let checked = 0;
      for (const path of enumerateShortestPathsGenerator(tree, { inventory: new Map() })) {
        const smeltIdx = path.findIndex((s: ActionStep) =>
          s.action === 'smelt' &&
          (s.result?.variants?.[0]?.value as { item?: string } | undefined)?.item === 'iron_ingot'
        );
        if (smeltIdx < 0) { checked++; if (checked >= 20) break; continue; }
        const ironMineIdx = path.findIndex((s: ActionStep) =>
          s.action === 'mine' &&
          (s.what?.variants || []).some(v => v.value === 'iron_ore' || v.value === 'deepslate_iron_ore')
        );
        if (ironMineIdx >= 0 && ironMineIdx < smeltIdx) { found = true; break; }
        checked++;
        if (checked >= 20) break;
      }
      expect(found).toBe(true);
    });

    test('smelt path is preserved when raw_iron is in inventory (no upstream mine needed)', () => {
      const inventory = new Map([
        ['raw_iron', 4],
        ['coal', 5],
        ['furnace', 1],
        ['crafting_table', 1]
      ]);
      // No iron_ore in world budget — pure inventory satisfaction
      const tree = plan(mcData, 'iron_ingot', 1, {
        log: false,
        inventory,
        pruneWithWorld: true,
        worldSnapshot: BARREN_SNAPSHOT,
        combineSimilarNodes: true
      });

      const hasSmeltBranch = tree.children.variants.some(c => c.value.action === 'smelt');
      expect(hasSmeltBranch).toBe(true);
    });
  });

  describe('cooked_beef regression — smelt path works when cows are present', () => {
    test('paths include hunt(cow) before smelt(beef->cooked_beef)', () => {
      const snapshotWithCows = {
        ...BARREN_SNAPSHOT,
        entities: { cow: { count: 5, closestDistance: 10, averageDistance: 15 } }
      };
      const tree = plan(mcData, 'cooked_beef', 4, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot: snapshotWithCows,
        combineSimilarNodes: true
      });

      let found = false;
      let checked = 0;
      for (const path of enumerateShortestPathsGenerator(tree, { inventory: new Map() })) {
        const smeltIdx = path.findIndex((s: ActionStep) =>
          s.action === 'smelt' &&
          (s.result?.variants?.[0]?.value as { item?: string } | undefined)?.item === 'cooked_beef'
        );
        if (smeltIdx < 0) { checked++; if (checked >= 20) break; continue; }
        if (pathHasStepProducing(path, 'beef', smeltIdx)) { found = true; break; }
        checked++;
        if (checked >= 20) break;
      }
      expect(found).toBe(true);
    });
  });
});
