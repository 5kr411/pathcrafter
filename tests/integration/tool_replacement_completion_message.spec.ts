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
      },
      registry: {
        items: {
          871: { maxDurability: 1561 }
        }
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

  it('waits for inventory update before announcing collection', () => {
    jest.useFakeTimers();

    try {
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

      executor['active'] = true;
      executor['target'] = { item: 'diamond_pickaxe', count: 2 };
      executor['startInventory'] = { diamond_pickaxe: 0 };
      executor['requiredGain'] = 2;

      let inventoryUpdated = false;
      mockBot.inventory.items.mockImplementation(() => {
        if (inventoryUpdated) {
          return [{ name: 'diamond_pickaxe', type: 871, count: 2 }];
        }
        return [{ name: 'diamond_pickaxe', type: 871, count: 0 }];
      });

      executor['finishExecution'](true);

      expect(chatMessages).toHaveLength(0);

      inventoryUpdated = true;
      jest.runOnlyPendingTimers();

      expect(chatMessages).toContain('collected diamond_pickaxe x2');
    } finally {
      jest.useRealTimers();
    }
  });

  it('MUST NOT say anything if plan fails', () => {
    jest.useFakeTimers();

    try {
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

      executor['active'] = true;
      executor['target'] = { item: 'diamond_pickaxe', count: 2 };
      executor['startInventory'] = { diamond_pickaxe: 0 };
      executor['requiredGain'] = 2;
      
      // Plan failed - still have 0 pickaxes
      mockBot.inventory.items.mockReturnValue([]);

      executor['finishExecution'](false);
      jest.runOnlyPendingTimers();

      // Should NOT say "collected" because it failed
      const hasCollectedMessage = chatMessages.some(msg => msg.includes('collected'));
      expect(hasCollectedMessage).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('announces collection even if state machine reports failure but inventory is satisfied', () => {
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

    executor['active'] = true;
    executor['target'] = { item: 'diamond_pickaxe', count: 2 };
    executor['startInventory'] = { diamond_pickaxe: 1 };
    executor['requiredGain'] = 1;

    mockBot.inventory.items.mockReturnValue([
      { name: 'diamond_pickaxe', type: 871, count: 2 }
    ]);

    executor['finishExecution'](false);

    expect(chatMessages).toContain('collected diamond_pickaxe x1');
  });

  it('announces collection when the original tool breaks during replacement', () => {
    jest.useFakeTimers();

    try {
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

      executor['active'] = true;
      executor['target'] = { item: 'diamond_pickaxe', count: 2 };
      executor['startInventory'] = { diamond_pickaxe: 1 };
      executor['requiredGain'] = 1;
      executor['startDurableCount'] = 0;

      mockBot.inventory.items.mockReturnValue([
        { name: 'diamond_pickaxe', type: 871, count: 1, durabilityUsed: 0 }
      ]);

      executor['finishExecution'](false);
      jest.runOnlyPendingTimers();
      jest.runOnlyPendingTimers();

      expect(chatMessages).toContain('collected diamond_pickaxe x1');
    } finally {
      jest.useRealTimers();
    }
  });
});

