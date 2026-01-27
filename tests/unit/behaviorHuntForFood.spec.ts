import createHuntForFoodState from '../../behaviors/behaviorHuntForFood';
import { createSimulatedBot } from '../helpers/reactiveTestHarness';

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

describe('behaviorHuntForFood - wooden sword prep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attempts to craft wooden_sword when no sword is present', async () => {
    const bot = createSimulatedBot({ inventory: { slots: new Array(46).fill(null) } });

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
    const bot = createSimulatedBot({
      inventory: {
        slots: new Array(46).fill(null),
        items: [{ name: 'stone_sword', count: 1 }]
      }
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
    const bot = createSimulatedBot({ inventory: { slots: new Array(46).fill(null) } });

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
    expect(stateMachine.isFinished()).toBe(true);
  });
});
