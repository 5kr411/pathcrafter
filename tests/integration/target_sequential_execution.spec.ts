import { TargetExecutor } from '../../bots/collector/target_executor';
import { ReactiveBehaviorExecutorClass } from '../../bots/collector/reactive_behavior_executor';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { createMockBot, createSchedulerHarness } from '../helpers/schedulerTestUtils';

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

jest.mock('mineflayer-statemachine', () => ({
  BotStateMachine: function BotStateMachine(this: any) {
    this.bot = null;
    this.rootStateMachine = null;
    this.states = [];
    this.transitions = [];
    this.nestedStateMachines = [];
  }
}));

import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { captureSnapshotForTarget } from '../../bots/collector/snapshot_manager';

const config = {
  snapshotRadii: [32],
  snapshotYHalf: null,
  pruneWithWorld: true,
  combineSimilarNodes: false,
  perGenerator: 1,
  toolDurabilityThreshold: 0.1
};

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitForPlanningRequest(worker: any, itemName: string, retries = 10): Promise<any> {
  for (let i = 0; i < retries; i += 1) {
    const record = worker.findByItem(itemName);
    if (record) {
      return record;
    }
    await flushPromises();
  }
  return null;
}

describe('TargetExecutor sequential target execution', () => {
  let bot: any;
  let executor: TargetExecutor;
  let workerManager: any;
  let scheduler: any;

  beforeEach(() => {
    jest.clearAllMocks();
    machines.length = 0;

    bot = createMockBot();
    const harness = createSchedulerHarness(bot);
    workerManager = harness.workerManager;
    scheduler = harness.scheduler;

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

    const reactiveExecutor = new ReactiveBehaviorExecutorClass(bot, new ReactiveBehaviorRegistry());
    executor = new TargetExecutor(bot, workerManager, jest.fn(), config, reactiveExecutor, undefined);

    scheduler.pushBehavior(executor);
  });

  it('activates a fresh state machine for each target in a chain', async () => {
    executor.setTargets([
      { item: 'crafting_table', count: 5 },
      { item: 'stick', count: 16 }
    ]);

    await scheduler.activateTop();
    await flushPromises();

    const firstRequest = await waitForPlanningRequest(workerManager, 'crafting_table');
    expect(firstRequest).not.toBeNull();
    workerManager.resolve(firstRequest.id, [[{ action: 'mine', what: 'birch_log' }]]);

    bot.inventory.items.mockReturnValue([
      { name: 'crafting_table', count: 5 }
    ]);

    bot.emit('physicTick');
    await flushPromises();

    const secondRequest = await waitForPlanningRequest(workerManager, 'stick');
    expect(secondRequest).not.toBeNull();
    workerManager.resolve(secondRequest.id, [[{ action: 'mine', what: 'birch_log' }]]);

    bot.inventory.items.mockReturnValue([
      { name: 'crafting_table', count: 5 },
      { name: 'stick', count: 16 }
    ]);

    bot.emit('physicTick');
    await flushPromises();

    expect(machines.length).toBe(2);
    expect(machines[0].onStateEntered).toHaveBeenCalledTimes(1);
    expect(machines[1].onStateEntered).toHaveBeenCalledTimes(1);
  });
});


