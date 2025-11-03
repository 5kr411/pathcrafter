import { TargetExecutor } from '../../bots/collector/target_executor';
import { WorkerManager } from '../../bots/collector/worker_manager';

describe('Target Completion Message Fix', () => {
  let mockBot: any;
  let mockWorkerManager: WorkerManager;
  let mockSafeChat: jest.Mock;
  let targetExecutor: TargetExecutor;
  let chatMessages: string[];

  beforeEach(() => {
    chatMessages = [];
    
    mockBot = {
      entity: { position: { x: 0, y: 60, z: 0 } },
      inventory: {
        items: jest.fn().mockReturnValue([
          { name: 'diamond', type: 870, count: 1 }
        ])
      },
      clearControlStates: jest.fn(),
      removeListener: jest.fn(),
      on: jest.fn()
    };

    mockWorkerManager = {
      postPlanningRequest: jest.fn(),
      clearPending: jest.fn(),
      stop: jest.fn()
    } as any;

    mockSafeChat = jest.fn((msg: string) => {
      chatMessages.push(msg);
    });

    targetExecutor = new TargetExecutor(mockBot, mockWorkerManager, mockSafeChat, {
      snapshotRadii: [32],
      snapshotYHalf: null,
      pruneWithWorld: true,
      combineSimilarNodes: false,
      perGenerator: 1,
      toolDurabilityThreshold: 0.1
    });
  });

  afterEach(() => {
    if (targetExecutor) {
      targetExecutor['stopReactiveBehaviorCheck']();
    }
    jest.clearAllMocks();
  });

  it('MUST say "collected X xY" when target completes, NOT "plan complete"', () => {
    const targets = [{ item: 'diamond', count: 1 }];
    targetExecutor.setTargets(targets);
    
    targetExecutor['sequenceTargets'] = targets;
    targetExecutor['sequenceIndex'] = 0;
    targetExecutor['currentTargetStartInventory'] = { diamond: 0 };
    
    mockBot.inventory.items.mockReturnValue([
      { name: 'diamond', type: 870, count: 1 }
    ]);
    
    targetExecutor['handleTargetSuccess']();
    
    expect(chatMessages).toContain('collected diamond x1');
    expect(chatMessages).not.toContain('plan complete: diamond x1');
    expect(chatMessages.some(msg => msg.includes('plan complete'))).toBe(false);
  });

  it('MUST say "collected" for multiple targets', () => {
    const targets = [
      { item: 'diamond', count: 3 },
      { item: 'iron_ingot', count: 5 }
    ];
    targetExecutor.setTargets(targets);
    
    targetExecutor['sequenceTargets'] = targets;
    targetExecutor['sequenceIndex'] = 0;
    targetExecutor['currentTargetStartInventory'] = { diamond: 0 };
    
    mockBot.inventory.items.mockReturnValue([
      { name: 'diamond', type: 870, count: 3 }
    ]);
    
    targetExecutor['handleTargetSuccess']();
    
    expect(chatMessages).toContain('collected diamond x3');
    
    chatMessages.length = 0;
    targetExecutor['sequenceIndex'] = 1;
    targetExecutor['currentTargetStartInventory'] = { iron_ingot: 0 };
    
    mockBot.inventory.items.mockReturnValue([
      { name: 'diamond', type: 870, count: 3 },
      { name: 'iron_ingot', type: 925, count: 5 }
    ]);
    
    targetExecutor['handleTargetSuccess']();
    
    expect(chatMessages).toContain('collected iron_ingot x5');
  });

  it('MUST NOT contain typo "comeplete"', () => {
    const targets = [{ item: 'oak_log', count: 10 }];
    targetExecutor.setTargets(targets);
    
    targetExecutor['sequenceTargets'] = targets;
    targetExecutor['sequenceIndex'] = 0;
    targetExecutor['currentTargetStartInventory'] = { oak_log: 0 };
    
    mockBot.inventory.items.mockReturnValue([
      { name: 'oak_log', type: 49, count: 10 }
    ]);
    
    targetExecutor['handleTargetSuccess']();
    
    const allMessages = chatMessages.join(' ');
    expect(allMessages).not.toContain('comeplete');
    expect(allMessages).not.toContain('plan complete');
  });
});

