import { TargetExecutor } from '../../bots/collector/target_executor';
import { createMockBot, createControlHarness } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn(),
  _internals: {
    logActionPath: jest.fn()
  }
}));

import { captureSnapshotForTarget } from '../../bots/collector/snapshot_manager';
import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitForPlanningRequest(worker: any, bot: any, itemName: string, retries = 10): Promise<any> {
  for (let i = 0; i < retries; i += 1) {
    const record = worker.findByItem(itemName);
    if (record) {
      return record;
    }
    bot.emit('physicTick');
    // eslint-disable-next-line no-await-in-loop
    await flushPromises();
  }
  return null;
}

describe('TargetExecutor execution startup', () => {
  let bot: any;
  let executor: TargetExecutor;
  let workerManager: any;
  let controlStack: any;

  beforeEach(() => {
    jest.clearAllMocks();
    bot = createMockBot();
    const harness = createControlHarness(bot);
    workerManager = harness.workerManager;
    controlStack = harness.controlStack;
    executor = controlStack.targetLayer;
    controlStack.start();

    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({
      snapshot: {
        radius: 32,
        blocks: {}
      }
    });
  });

  afterEach(() => {
    controlStack.stop();
  });

  it('calls onStateEntered on the path machine so execution can progress', async () => {
    const onStateEntered = jest.fn();
    const onStateExited = jest.fn();
    let started = false;
    let finished = false;

    (buildStateMachineForPath as jest.Mock).mockImplementation((_bot: any, _path: any[], onFinished?: (success: boolean) => void) => {
      return {
        onStateEntered: () => {
          started = true;
          onStateEntered();
        },
        onStateExited,
        update: () => {
          if (!started || finished) return;
          finished = true;
          if (onFinished) onFinished(true);
        }
      };
    });

    bot.inventory.items.mockReturnValue([
      { name: 'diamond_pickaxe', count: 2 }
    ]);

    executor.setTargets([{ item: 'diamond_pickaxe', count: 2 }]);
    await executor.startNextTarget();
    await flushPromises();

    const request = await waitForPlanningRequest(workerManager, bot, 'diamond_pickaxe');
    expect(request).not.toBeNull();
    workerManager.resolve(request.id, [[{ action: 'mine', what: 'deepslate_diamond_ore', count: 3 }]]);

    for (let i = 0; i < 6; i += 1) {
      bot.emit('physicTick');
      // eslint-disable-next-line no-await-in-loop
      await flushPromises();
    }

    expect(onStateEntered).toHaveBeenCalled();
    expect(executor.isRunning()).toBe(false);
  });
});
