import plan from '../../planner';
import {
  initWorkstationCostCache,
  clearWorkstationCostCache,
} from '../../utils/workstationCostCache';
import { enumerateLowestWeightPathsGenerator } from '../../path_generators/lowestWeightPathsGenerator';
import { getCachedMcData } from '../testHelpers';

describe('workstation mining penalty integration', () => {
  const mcData = getCachedMcData('1.20.1');

  const makeWorldSnapshot = () => ({
    version: '1.20.1',
    dimension: 'overworld',
    center: { x: 0, y: 64, z: 0 },
    radius: 128,
    yMin: 0,
    yMax: 255,
    blocks: {
      crafting_table: { count: 1, closestDistance: 10, averageDistance: 10 },
      oak_log: { count: 64, closestDistance: 5, averageDistance: 8 },
    },
    entities: {},
  });

  beforeAll(() => {
    initWorkstationCostCache(mcData, ['crafting_table', 'furnace']);
  });

  afterAll(() => {
    clearWorkstationCostCache();
  });

  it('craft path for crafting_table ranks above mine-from-world path', () => {
    const worldSnapshot = makeWorldSnapshot();

    const tree = plan(mcData, 'crafting_table', 1, {
      inventory: new Map<string, number>(),
      pruneWithWorld: true,
      worldSnapshot,
      log: false,
    });

    const gen = enumerateLowestWeightPathsGenerator(tree, {});
    const result = gen.next();
    expect(result.done).toBe(false);
    const firstPath = result.value!;

    // The first (lowest-weight) path should NOT be mining a crafting_table
    const hasMineWorkstation = firstPath.some(
      (step: any) =>
        step.action === 'mine' &&
        step.what?.variants?.some((v: any) => v.value === 'crafting_table')
    );
    expect(hasMineWorkstation).toBe(false);
  });

  it('mine-from-world path still exists as a fallback', () => {
    const worldSnapshot = makeWorldSnapshot();

    const tree = plan(mcData, 'crafting_table', 1, {
      inventory: new Map<string, number>(),
      pruneWithWorld: true,
      worldSnapshot,
      log: false,
    });

    const gen = enumerateLowestWeightPathsGenerator(tree, {});
    const paths: any[] = [];
    for (const path of gen) {
      paths.push(path);
      if (paths.length >= 20) break;
    }

    // At least one path should mine the crafting_table (fallback)
    const hasMinePath = paths.some((path: any) =>
      path.some(
        (step: any) =>
          step.action === 'mine' &&
          step.what?.variants?.some((v: any) => v.value === 'crafting_table')
      )
    );
    expect(hasMinePath).toBe(true);
  });
});
