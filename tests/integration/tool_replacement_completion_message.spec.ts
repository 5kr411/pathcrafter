import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';

describe('Tool Replacement Completion Message', () => {
  let mockBot: any;
  let mockWorkerManager: any;
  let mockSafeChat: jest.Mock;
  let chatMessages: string[];

  beforeEach(() => {
    chatMessages = [];
    
    mockBot = {
      entity: { position: { x: 0, y: 60, z: 0 } },
      inventory: {
        items: jest.fn().mockReturnValue([
          { name: 'diamond_pickaxe', type: 871, count: 1 }
        ])
      }
    };

    mockWorkerManager = {
      postPlanningRequest: jest.fn(),
      clearPending: jest.fn(),
      stop: jest.fn()
    };

    mockSafeChat = jest.fn((msg: string) => {
      chatMessages.push(msg);
    });
  });

  it('MUST say "collected diamond_pickaxe x2" when tool replacement succeeds', () => {
    const executor = new ToolReplacementExecutor(
      mockBot,
      mockWorkerManager,
      mockSafeChat,
      {
        snapshotRadii: [32],
        snapshotYHalf: null,
        pruneWithWorld: true,
        combineSimilarNodes: false,
        perGenerator: 1,
        toolDurabilityThreshold: 0.1
      }
    );

    // Set up state as if we started with 0 diamond pickaxes
    executor['target'] = { item: 'diamond_pickaxe', count: 2 };
    executor['startInventory'] = { diamond_pickaxe: 0 };
    executor['requiredGain'] = 2;
    
    // Simulate plan completion - now we have 2 diamond pickaxes
    mockBot.inventory.items.mockReturnValue([
      { name: 'diamond_pickaxe', type: 871, count: 2 }
    ]);

    // Call finishExecution as the state machine would
    executor['finishExecution'](true);

    // Should have said "collected diamond_pickaxe x2"
    expect(chatMessages).toContain('collected diamond_pickaxe x2');
  });

  it('MUST say "collected diamond_pickaxe x1" when replacing from 1 to 2', () => {
    const executor = new ToolReplacementExecutor(
      mockBot,
      mockWorkerManager,
      mockSafeChat,
      {
        snapshotRadii: [32],
        snapshotYHalf: null,
        pruneWithWorld: true,
        combineSimilarNodes: false,
        perGenerator: 1,
        toolDurabilityThreshold: 0.1
      }
    );

    // Started with 1 pickaxe, needed to gain 1 more
    executor['target'] = { item: 'diamond_pickaxe', count: 2 };
    executor['startInventory'] = { diamond_pickaxe: 1 };
    executor['requiredGain'] = 1;
    
    // Now we have 2 pickaxes
    mockBot.inventory.items.mockReturnValue([
      { name: 'diamond_pickaxe', type: 871, count: 2 }
    ]);

    executor['finishExecution'](true);

    // Should say we collected 1 (the gain)
    expect(chatMessages).toContain('collected diamond_pickaxe x1');
  });

  it('MUST NOT say anything if plan fails', () => {
    const executor = new ToolReplacementExecutor(
      mockBot,
      mockWorkerManager,
      mockSafeChat,
      {
        snapshotRadii: [32],
        snapshotYHalf: null,
        pruneWithWorld: true,
        combineSimilarNodes: false,
        perGenerator: 1,
        toolDurabilityThreshold: 0.1
      }
    );

    executor['target'] = { item: 'diamond_pickaxe', count: 2 };
    executor['startInventory'] = { diamond_pickaxe: 0 };
    executor['requiredGain'] = 2;
    
    // Plan failed - still have 0 pickaxes
    mockBot.inventory.items.mockReturnValue([]);

    executor['finishExecution'](false);

    // Should NOT say "collected" because it failed
    const hasCollectedMessage = chatMessages.some(msg => msg.includes('collected'));
    expect(hasCollectedMessage).toBe(false);
  });
});

