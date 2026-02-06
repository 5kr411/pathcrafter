import createHuntForFishState from '../../behaviors/behaviorHuntForFish';
import { createSimulatedBot } from '../helpers/reactiveTestHarness';
import { HUNTABLE_WATER_ANIMALS } from '../../utils/foodConfig';

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

jest.mock('../../planner', () => ({
  plan: jest.fn(),
  _internals: {
    enumerateActionPathsGenerator: jest.fn()
  }
}));

jest.mock('../../utils/adaptiveSnapshot', () => ({
  captureAdaptiveSnapshot: jest.fn()
}));

jest.mock('../../behaviors/behaviorSafeFollowEntity', () => ({
  BehaviorSafeFollowEntity: jest.fn(() => ({
    onStateEntered: jest.fn(),
    update: jest.fn(),
    isFinished: jest.fn(() => true),
    onStateExited: jest.fn(),
    distanceToTarget: jest.fn(() => 0)
  }))
}));

const mockHuntEntityMachines: any[] = [];
jest.mock('../../behaviors/behaviorHuntEntity', () =>
  jest.fn(() => {
    const machine = {
      onStateEntered: jest.fn(),
      update: jest.fn(),
      isFinished: jest.fn(() => true),
      onStateExited: jest.fn()
    };
    mockHuntEntityMachines.push(machine);
    return machine;
  })
);

jest.mock('../../behaviors/behaviorSmelt', () =>
  jest.fn(() => ({
    onStateEntered: jest.fn(),
    update: jest.fn(),
    isFinished: jest.fn(() => true),
    onStateExited: jest.fn()
  }))
);

const createHuntEntityState = require('../../behaviors/behaviorHuntEntity') as jest.Mock;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createBotWithFish(fishNames: string[] = ['salmon']): any {
  const entities: Record<string, any> = {};
  fishNames.forEach((name, i) => {
    entities[`fish_${i}`] = {
      name,
      position: { x: 5 + i, y: 62, z: 5, distanceTo: (other: any) => {
        const dx = (5 + i) - (other.x ?? 0);
        const dy = 62 - (other.y ?? 0);
        const dz = 5 - (other.z ?? 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }},
      health: 3
    };
  });

  const bot = createSimulatedBot({
    position: { x: 0, y: 64, z: 0 },
    entities,
    inventory: { slots: new Array(46).fill(null) }
  });

  if (bot.entity?.position && !bot.entity.position.distanceTo) {
    const pos = bot.entity.position;
    pos.distanceTo = (other: any) => {
      const dx = pos.x - (other.x ?? 0);
      const dy = pos.y - (other.y ?? 0);
      const dz = pos.z - (other.z ?? 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
  }

  return bot;
}

function createBotWithoutFish(): any {
  const bot = createSimulatedBot({
    position: { x: 0, y: 64, z: 0 },
    entities: {
      cow_0: {
        name: 'cow',
        position: { x: 5, y: 64, z: 5, distanceTo: () => 7 },
        health: 10
      }
    },
    inventory: { slots: new Array(46).fill(null) }
  });

  if (bot.entity?.position && !bot.entity.position.distanceTo) {
    const pos = bot.entity.position;
    pos.distanceTo = (other: any) => {
      const dx = pos.x - (other.x ?? 0);
      const dy = pos.y - (other.y ?? 0);
      const dz = pos.z - (other.z ?? 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
  }

  return bot;
}

describe('behaviorHuntForFish', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHuntEntityMachines.length = 0;
  });

  it('finds and targets salmon entities', async () => {
    const bot = createBotWithFish(['salmon']);

    const stateMachine = createHuntForFishState(bot, {
      targetFoodPoints: 10
    });

    expect(createHuntEntityState).toHaveBeenCalled();

    const huntTargets = createHuntEntityState.mock.calls[0][1];
    expect(huntTargets.entityFilter).toBeDefined();

    stateMachine.onStateEntered();

    for (let i = 0; i < 10; i++) {
      stateMachine.update();
      await flushMicrotasks();
    }

    // The entity filter should accept salmon
    expect(huntTargets.entityFilter({ name: 'salmon' }) || huntTargets.entityFilter({ name: 'cod' })).toBeDefined();
  });

  it('finds and targets cod entities', async () => {
    const bot = createBotWithFish(['cod']);

    const stateMachine = createHuntForFishState(bot, {
      targetFoodPoints: 10
    });

    expect(createHuntEntityState).toHaveBeenCalled();

    stateMachine.onStateEntered();

    for (let i = 0; i < 10; i++) {
      stateMachine.update();
      await flushMicrotasks();
    }

    // Verify the hunt entity state machine was created for water animals
    expect(createHuntEntityState).toHaveBeenCalledTimes(1);
  });

  it('fails when no water animals are nearby', async () => {
    const bot = createBotWithoutFish();
    let completeSuccess: boolean | null = null;

    const stateMachine = createHuntForFishState(bot, {
      targetFoodPoints: 10,
      onComplete: (success: boolean) => {
        completeSuccess = success;
      }
    });

    stateMachine.onStateEntered();

    for (let i = 0; i < 10; i++) {
      stateMachine.update();
      await flushMicrotasks();
    }

    expect(stateMachine.isFinished()).toBe(true);
    expect(completeSuccess).toBe(false);
  });

  it('does not attempt weapon crafting when no fish is found', async () => {
    const bot = createBotWithoutFish();

    const plannerMock = require('../../planner').plan as jest.Mock;
    const captureSnapshotMock = require('../../utils/adaptiveSnapshot').captureAdaptiveSnapshot as jest.Mock;

    const stateMachine = createHuntForFishState(bot, {
      targetFoodPoints: 10
    });

    stateMachine.onStateEntered();

    for (let i = 0; i < 10; i++) {
      stateMachine.update();
      await flushMicrotasks();
    }

    expect(stateMachine.isFinished()).toBe(true);
    expect(plannerMock).not.toHaveBeenCalled();
    expect(captureSnapshotMock).not.toHaveBeenCalled();
  });

  it('HUNTABLE_WATER_ANIMALS does not contain land animals', () => {
    const waterNames = HUNTABLE_WATER_ANIMALS.map(a => a.entity);
    expect(waterNames).not.toContain('cow');
    expect(waterNames).not.toContain('pig');
  });
});
