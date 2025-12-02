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

import { _internals, createBehaviorForStep } from '../../behavior_generator';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup, getCachedMcData } from '../testHelpers';

describe('unit: behavior_generator craft-in-table mapping', () => {
    test('computeTargetsForCraftInTable calculates total amount', () => {
        const step = createTestActionStep({ action: 'craft', what: createTestStringGroup('table'), count: 2, result: createTestItemReferenceGroup('wooden_pickaxe', 1) });
        const t = _internals.computeTargetsForCraftInTable(step);
        expect(t).toEqual({ itemName: 'wooden_pickaxe', amount: 2 });
    });

    test('createBehaviorForStep returns behavior for craft in table and includes break step hook', () => {
        const mcData = getCachedMcData('1.20.1');
        const bot = { 
            version: '1.20.1', 
            mcData, 
            inventory: { 
                items: () => [], 
                slots: [], 
                firstEmptyInventorySlot: () => 9 
            }, 
            world: { 
                getBlockType: () => 0 
            }, 
            findBlock: () => null, 
            craft: jest.fn(), 
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
        const step = createTestActionStep({ action: 'craft', what: createTestStringGroup('table'), count: 1, result: createTestItemReferenceGroup('wooden_pickaxe', 1) });
        const behavior = createBehaviorForStep(bot, step);
        expect(behavior).toBeTruthy();
        expect(typeof behavior).toBe('object');
        expect(Array.isArray((behavior as any).states)).toBe(true);
        // The wrapped craft with table state has more internal states
        expect((behavior as any).states.length).toBeGreaterThan(3);
    });
});

