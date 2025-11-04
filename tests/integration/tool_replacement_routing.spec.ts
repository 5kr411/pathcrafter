import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';
import { PendingEntry, Snapshot, Target } from '../../bots/collector/config';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

jest.mock('mineflayer-statemachine', () => ({
  BotStateMachine: jest.fn().mockImplementation(() => ({
    stop: jest.fn()
  }))
}));

const { captureSnapshotForTarget } = require('../../bots/collector/snapshot_manager');
const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine');

type ResultHandler = (entry: PendingEntry, ranked: any[], ok: boolean, error?: string) => void;

class FakeWorkerManager {
  private pending = new Map<string, { target: Target; snapshot: Snapshot; handler?: ResultHandler }>();
  private lastId: string | null = null;

  constructor(private defaultHandler: ResultHandler) {}

  postPlanningRequest(...args: any[]): void {
    const [
      id,
      target,
      snapshot,
      _inventory,
      _version,
      _perGenerator,
      _pruneWithWorld,
      _combineSimilarNodes,
      handler
    ] = args;

    this.pending.set(id, { target, snapshot, handler });
    this.lastId = id;
  }

  triggerSuccess(ranked: any[]): void {
    if (!this.lastId) {
      throw new Error('No pending requests to resolve');
    }

    const entry = this.pending.get(this.lastId);
    this.pending.delete(this.lastId);
    this.lastId = null;

    const callback = entry?.handler || this.defaultHandler;
    callback(entry as PendingEntry, ranked, true);
  }
}

describe('ToolReplacementExecutor routing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should announce replacement success once worker result routes back to the executor', async () => {
    const snapshot: Snapshot = { radius: 32 };
    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot });
    (buildStateMachineForPath as jest.Mock).mockImplementation(
      (_bot: any, _path: any[], onFinished: (success: boolean) => void) => {
        setTimeout(() => onFinished(true), 10);
        return {};
      }
    );

    const chatMessages: string[] = [];
    const safeChat = (msg: string) => {
      chatMessages.push(msg);
    };

    let inventoryPhase: 'before' | 'after' = 'before';
    const mockBot: any = {
      version: '1.20.1',
      inventory: {
        items: jest.fn(() => {
          if (inventoryPhase === 'before') {
            return [
              { name: 'diamond_pickaxe', type: 871, count: 1, durabilityUsed: 1551 }
            ];
          }
          return [
            { name: 'diamond_pickaxe', type: 871, count: 1, durabilityUsed: 1551 },
            { name: 'diamond_pickaxe', type: 871, count: 1, durabilityUsed: 0 }
          ];
        })
      },
      registry: {
        items: {
          871: { maxDurability: 1561 }
        }
      }
    };

    const defaultHandler = jest.fn();
    const workerManager = new FakeWorkerManager(defaultHandler);

    const executor = new ToolReplacementExecutor(
      mockBot,
      workerManager as any,
      safeChat,
      {
        snapshotRadii: [32],
        snapshotYHalf: null,
        pruneWithWorld: true,
        combineSimilarNodes: false,
        perGenerator: 1,
        toolDurabilityThreshold: 0.1
      }
    );

    const promise = executor.executeReplacement('diamond_pickaxe');
    await Promise.resolve();

    inventoryPhase = 'after';
    workerManager.triggerSuccess([
      { action: 'mine', what: 'oak_log', count: 2 }
    ]);

    jest.advanceTimersByTime(10);
    await Promise.resolve();

    expect(chatMessages).toContain('collected diamond_pickaxe x1');

    const race = Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('did not resolve')), 100))
    ]);
    jest.advanceTimersByTime(100);
    await expect(race).resolves.toBe(true);
  });
});

