import createCollectBerriesState from '../../behaviors/behaviorCollectBerries';
import { createSimulatedBot } from '../helpers/reactiveTestHarness';

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn(),
  _internals: {
    logActionPath: jest.fn()
  }
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

const planner = require('../../planner').plan as jest.Mock;
const enumerateActionPathsGenerator = require('../../planner')._internals.enumerateActionPathsGenerator as jest.Mock;
const buildStateMachineForPath = require('../../behavior_generator/buildMachine').buildStateMachineForPath as jest.Mock;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('behaviorCollectBerries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips glow berries when iron pickaxe is missing', async () => {
    const bot = createSimulatedBot({ inventory: { slots: new Array(46).fill(null) } });

    planner.mockImplementation(() => null);

    const stateMachine = createCollectBerriesState(bot as any, {
      targetBerryCount: 2,
      worldSnapshot: { radius: 16 },
      requireIronForGlow: true
    });

    stateMachine.onStateEntered();
    stateMachine.update();
    await flushMicrotasks();

    const plannedItems = planner.mock.calls.map((call) => call[1]);
    expect(plannedItems).toContain('sweet_berries');
    expect(plannedItems).not.toContain('glow_berries');
  });

  it('completes when the path machine finishes', async () => {
    const bot = createSimulatedBot({ inventory: { slots: new Array(46).fill(null) } });

    planner.mockImplementation(() => ({}));
    enumerateActionPathsGenerator.mockImplementation(function* () {
      yield [{ action: 'mine', what: 'sweet_berries', count: 2 }];
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

    const stateMachine = createCollectBerriesState(bot as any, {
      targetBerryCount: 2,
      worldSnapshot: { radius: 16 },
      requireIronForGlow: false
    });

    stateMachine.onStateEntered();

    for (let i = 0; i < 3; i += 1) {
      stateMachine.update();
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks();
    }

    expect(stateMachine.isFinished()).toBe(true);
  });
});
