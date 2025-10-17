// Stub BehaviorMoveTo and BehaviorFollowEntity to avoid minecraft-data/pathfinder dependency in tests
jest.mock('mineflayer-statemachine', () => {
  const real = jest.requireActual('mineflayer-statemachine');
  class BehaviorMoveToMock {
    stateName = 'moveTo';
    active = false;
    constructor(_bot: any, _targets: any) {}
    onStateEntered() {}
    onStateExited() {}
    isFinished() { return true; }
    distanceToTarget() { return 0; }
  }
  class BehaviorFollowEntityMock {
    stateName = 'followEntity';
    active = false;
    constructor(_bot: any, _targets: any) {}
    onStateEntered() {}
    onStateExited() {}
    isFinished() { return true; }
    distanceToTarget() { return 0; }
  }
  return Object.assign({}, real, { 
    BehaviorMoveTo: BehaviorMoveToMock,
    BehaviorFollowEntity: BehaviorFollowEntityMock,
    globalSettings: (real as any).globalSettings || { debugMode: false }
  });
});

import { ActionStep } from '../../action_tree/types';
import plan from '../../planner';
import { createBehaviorForStep } from '../../behavior_generator';

describe('integration: behavior_generator craft-in-table', () => {
    const { resolveMcData, enumerateLowestWeightPathsGenerator } = (plan as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('creates behavior for a craft-in-table step from planner path with break step', () => {
        const inventory = new Map([["oak_planks", 4], ["stick", 2]]);
        const tree = plan(mcData, 'wooden_pickaxe', 1, { log: false, inventory });
        const [path] = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory })) as ActionStep[][];
        expect(path).toBeDefined();
        const craftTableStep = path.find((s: any) => s.action === 'craft' && s.what.variants[0].value === 'table' && s.result && s.result.variants[0].value.item === 'wooden_pickaxe');
        expect(craftTableStep).toBeDefined();
        const mc = require('minecraft-data')('1.20.1');
        const bot = { 
            version: '1.20.1', 
            mcData: mc, 
            inventory: { 
                items: () => [{ name: 'crafting_table' }], 
                slots: [], 
                firstEmptyInventorySlot: () => 9 
            }, 
            world: { 
                getBlockType: () => 0 
            }, 
            findBlock: () => null, 
            craft: async () => {}, 
            entity: { 
                position: { 
                    clone: () => ({ 
                        x: 0, y: 64, z: 0, 
                        offset: (x: number, y: number, z: number) => ({ x, y, z }), 
                        floored: () => ({ x: 0, y: 64, z: 0 }) 
                    }) 
                } 
            } 
        } as any;
        const behavior = createBehaviorForStep(bot, craftTableStep!);
        expect(behavior).toBeTruthy();
        expect(Array.isArray((behavior as any).states)).toBe(true);
        // The wrapped craft with table state has more internal states
        expect((behavior as any).states.length).toBeGreaterThan(3);
    });
});

