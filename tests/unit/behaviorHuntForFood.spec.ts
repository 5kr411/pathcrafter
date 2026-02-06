import createHuntForFoodState from '../../behaviors/behaviorHuntForFood';
import { createSimulatedBot } from '../helpers/reactiveTestHarness';
import { HUNTABLE_LAND_ANIMALS } from '../../utils/foodConfig';

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

jest.mock('../../behaviors/behaviorHuntEntity', () =>
  jest.fn(() => ({
    onStateEntered: jest.fn(),
    update: jest.fn(),
    isFinished: jest.fn(() => true),
    onStateExited: jest.fn()
  }))
);

const planner = require('../../planner').plan as jest.Mock;
const enumerateActionPathsGenerator = require('../../planner')._internals.enumerateActionPathsGenerator as jest.Mock;
const buildStateMachineForPath = require('../../behavior_generator/buildMachine').buildStateMachineForPath as jest.Mock;
const captureAdaptiveSnapshot = require('../../utils/adaptiveSnapshot').captureAdaptiveSnapshot as jest.Mock;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makePos(x: number, y: number, z: number) {
  return {
    x, y, z,
    clone() { return makePos(x, y, z); },
    distanceTo(other: any) {
      const dx = x - (other.x ?? 0);
      const dy = y - (other.y ?? 0);
      const dz = z - (other.z ?? 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  };
}

function createBotWithAnimal(inventoryOpts?: { slots?: any[]; items?: any[] }): any {
  const animalName = HUNTABLE_LAND_ANIMALS[0].entity;
  const bot = createSimulatedBot({
    position: { x: 0, y: 64, z: 0 },
    entities: {
      animal_0: {
        name: animalName,
        position: makePos(5, 64, 5),
        health: 10
      }
    },
    inventory: inventoryOpts ?? { slots: new Array(46).fill(null) }
  });

  if (bot.entity?.position && !bot.entity.position.distanceTo) {
    const pos = bot.entity.position;
    const px = pos.x, py = pos.y, pz = pos.z;
    pos.distanceTo = (other: any) => {
      const dx = px - (other.x ?? 0);
      const dy = py - (other.y ?? 0);
      const dz = pz - (other.z ?? 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
  }

  return bot;
}

describe('behaviorHuntForFood - wooden sword prep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attempts to craft wooden_sword when no sword is present', async () => {
    const bot = createBotWithAnimal();

    planner.mockImplementation(() => ({}));
    enumerateActionPathsGenerator.mockImplementation(function* () {
      yield [{ action: 'mine', what: 'oak_log', count: 1 }];
    });
    captureAdaptiveSnapshot.mockResolvedValue({
      snapshot: { radius: 32 },
      radiusUsed: 32,
      attemptsCount: 1,
      totalTimeMs: 1
    });

    buildStateMachineForPath.mockImplementation((_bot: any, _path: any[], onFinished?: (success: boolean) => void) => {
      let finished = false;
      return {
        onStateEntered: jest.fn(),
        update: () => {
          if (finished) return;
          finished = true;
          if (onFinished) onFinished(true);
        },
        isFinished: () => finished
      };
    });

    const stateMachine = createHuntForFoodState(bot as any, { targetFoodPoints: 10 });
    stateMachine.onStateEntered();

    for (let i = 0; i < 5; i += 1) {
      stateMachine.update();
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks();
    }

    const plannedItems = planner.mock.calls.map((call) => call[1]);
    expect(plannedItems).toContain('wooden_sword');
    expect(buildStateMachineForPath).toHaveBeenCalled();
  });

  it('skips weapon planning when a sword is already in inventory', async () => {
    const bot = createBotWithAnimal({
      slots: new Array(46).fill(null),
      items: [{ name: 'stone_sword', count: 1 }]
    });

    const stateMachine = createHuntForFoodState(bot as any, { targetFoodPoints: 10 });
    stateMachine.onStateEntered();

    for (let i = 0; i < 3; i += 1) {
      stateMachine.update();
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks();
    }

    expect(planner).not.toHaveBeenCalled();
    expect(buildStateMachineForPath).not.toHaveBeenCalled();
  });

  it('continues without weapon when no viable path is found', async () => {
    const bot = createBotWithAnimal();

    planner.mockImplementation(() => ({}));
    enumerateActionPathsGenerator.mockImplementation(function* () {
      // no paths
    });
    captureAdaptiveSnapshot.mockResolvedValue({
      snapshot: { radius: 32 },
      radiusUsed: 32,
      attemptsCount: 1,
      totalTimeMs: 1
    });

    const stateMachine = createHuntForFoodState(bot as any, { targetFoodPoints: 10 });
    stateMachine.onStateEntered();

    for (let i = 0; i < 6; i += 1) {
      stateMachine.update();
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks();
    }

    expect(buildStateMachineForPath).not.toHaveBeenCalled();
  });

  it('does not attempt weapon crafting when no animal is found', async () => {
    const bot = createSimulatedBot({
      position: { x: 0, y: 64, z: 0 },
      entities: {},
      inventory: { slots: new Array(46).fill(null) }
    });

    const stateMachine = createHuntForFoodState(bot as any, { targetFoodPoints: 10 });
    stateMachine.onStateEntered();

    for (let i = 0; i < 6; i += 1) {
      stateMachine.update();
      await flushMicrotasks();
    }

    expect(planner).not.toHaveBeenCalled();
    expect(captureAdaptiveSnapshot).not.toHaveBeenCalled();
    expect(stateMachine.isFinished()).toBe(true);
  });
});
