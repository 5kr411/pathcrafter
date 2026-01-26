import { TargetExecutor } from '../../bots/collector/target_executor';
import { createMockBot, createControlHarness } from '../helpers/schedulerTestUtils';

const machines: any[] = [];

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn(),
  _internals: {
    logActionPath: jest.fn()
  }
}));

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { captureSnapshotForTarget } from '../../bots/collector/snapshot_manager';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitForPlanningRequest(worker: any, itemName: string, retries = 10): Promise<any> {
  for (let i = 0; i < retries; i += 1) {
    const record = worker.findByItem(itemName);
    if (record) {
      return record;
    }
    if (typeof worker.onWaitTick === 'function') {
      worker.onWaitTick();
    }
    await flushPromises();
  }
  return null;
}

describe('TargetExecutor sequential target execution', () => {
  let bot: any;
  let executor: TargetExecutor;
  let workerManager: any;
  let controlStack: any;

  beforeEach(() => {
    jest.clearAllMocks();
    machines.length = 0;

    bot = createMockBot();
    const harness = createControlHarness(bot);
    workerManager = harness.workerManager;
    controlStack = harness.controlStack;
    executor = controlStack.targetLayer;
    controlStack.start();

    workerManager.onWaitTick = () => {
      bot.emit('physicTick');
    };

    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({
      snapshot: {
        radius: 32,
        blocks: {}
      }
    });

    (buildStateMachineForPath as jest.Mock).mockImplementation(
      (_bot: any, _path: any[], onFinished?: (success: boolean) => void) => {
        const machine: any = {
          active: false,
          onStateEntered: jest.fn(),
          onStateExited: jest.fn(),
          update: jest.fn(() => {
            if (!machine._completed) {
              machine._completed = true;
              if (onFinished) {
                onFinished(true);
              }
            }
          })
        };

        machines.push(machine);
        return machine;
      }
    );
  });

  it('activates a fresh state machine for each target in a chain', async () => {
    executor.setTargets([
      { item: 'crafting_table', count: 5 },
      { item: 'stick', count: 16 }
    ]);

    await executor.startNextTarget();
    await flushPromises();

    const firstRequest = await waitForPlanningRequest(workerManager, 'crafting_table');
    expect(firstRequest).not.toBeNull();
    workerManager.resolve(firstRequest.id, [[{ action: 'mine', what: 'birch_log' }]]);

    bot.inventory.items.mockReturnValue([
      { name: 'crafting_table', count: 5 }
    ]);

    for (let i = 0; i < 4; i += 1) {
      bot.emit('physicTick');
      // eslint-disable-next-line no-await-in-loop
      await flushPromises();
    }

    const secondRequest = await waitForPlanningRequest(workerManager, 'stick');
    expect(secondRequest).not.toBeNull();
    workerManager.resolve(secondRequest.id, [[{ action: 'mine', what: 'birch_log' }]]);

    bot.inventory.items.mockReturnValue([
      { name: 'crafting_table', count: 5 },
      { name: 'stick', count: 16 }
    ]);

    for (let i = 0; i < 4; i += 1) {
      bot.emit('physicTick');
      // eslint-disable-next-line no-await-in-loop
      await flushPromises();
    }

    expect(machines.length).toBe(2);
    expect(machines[0].update).toHaveBeenCalled();
    expect(machines[1].update).toHaveBeenCalled();
  });
});
