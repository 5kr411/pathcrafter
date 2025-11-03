import BehaviorSmartMoveTo, { globalDurabilityWarnings } from '../../behaviors/behaviorSmartMoveTo';
import logger from '../../utils/logger';

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../utils/toolValidation', () => ({
  getToolRemainingUses: jest.fn()
}));

jest.mock('mineflayer-statemachine', () => ({
  BehaviorMoveTo: jest.fn().mockImplementation(() => ({
    distance: 0,
    isFinished: jest.fn().mockReturnValue(false),
    distanceToTarget: jest.fn().mockReturnValue(10),
    onStateEntered: jest.fn(),
    onStateExited: jest.fn()
  }))
}));

const { getToolRemainingUses } = require('../../utils/toolValidation');

describe('Durability Warning After Tool Replacement', () => {
  let mockBot: any;
  let mockTargets: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Clear the global durability warnings map between tests
    globalDurabilityWarnings.clear();

    mockBot = {
      entity: { position: { x: 0, y: 60, z: 0 } },
      heldItem: {
        name: 'diamond_pickaxe',
        type: 871
      },
      registry: {
        items: {
          871: {
            maxDurability: 1561
          }
        }
      }
    };

    mockTargets = {
      position: { x: 10, y: 60, z: 10 },
      executionContext: {
        durabilityThreshold: 0.1,
        toolsBeingReplaced: new Set(),
        onToolIssue: jest.fn(),
        toolIssueDetected: false,
        toolIssue: null
      }
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('MUST warn again after tool replacement when NEW tool also gets low durability', () => {
    // Scenario from user:
    // 1. Pick 1 has 10 uses left (0.6%) -> warn
    // 2. Replace with Pick 2 (1561 uses)
    // 3. Pick 2 degrades to 156 uses (10%) -> MUST warn again!

    // First tool: diamond_pickaxe with 10/1561 uses (0.6%)
    getToolRemainingUses.mockReturnValue(10);
    
    const behavior1 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    behavior1.onStateEntered();
    jest.advanceTimersByTime(1000);
    
    const firstWarning = (logger.info as jest.Mock).mock.calls.filter(
      call => call[0].includes('low durability')
    ).length;
    expect(firstWarning).toBe(1);

    behavior1.onStateExited();
    (logger.info as jest.Mock).mockClear();

    // Tool replacement happens (simulated by tool having more durability)
    // Now we have a NEW diamond_pickaxe with 1561/1561 uses
    getToolRemainingUses.mockReturnValue(1561);
    
    const behavior2 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    behavior2.onStateEntered();
    jest.advanceTimersByTime(1000);
    
    // No warning yet because durability is high (1561 > 156 threshold)
    const noWarning = (logger.info as jest.Mock).mock.calls.filter(
      call => call[0].includes('low durability')
    ).length;
    expect(noWarning).toBe(0);

    behavior2.onStateExited();
    (logger.info as jest.Mock).mockClear();

    // NEW tool degrades to 156/1561 uses (10% exactly at threshold)
    getToolRemainingUses.mockReturnValue(156);
    
    const behavior3 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    behavior3.onStateEntered();
    jest.advanceTimersByTime(1000);
    
    const secondWarning = (logger.info as jest.Mock).mock.calls.filter(
      call => call[0].includes('low durability')
    ).length;
    
    // MUST warn again because this is a DIFFERENT tool instance
    // The condition checks: 156 > 10 + 100 = 156 > 110 = TRUE, so it warns
    expect(secondWarning).toBe(1);

    behavior3.onStateExited();
  });

  it('MUST NOT spam after the NEW tool warning', () => {
    // After we warn about the new tool, subsequent states shouldn't spam

    // Old tool: 10 uses
    getToolRemainingUses.mockReturnValue(10);
    const b1 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    b1.onStateEntered();
    jest.advanceTimersByTime(1000);
    b1.onStateExited();
    (logger.info as jest.Mock).mockClear();

    // New tool: 156 uses (low durability)
    getToolRemainingUses.mockReturnValue(156);
    const b2 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    b2.onStateEntered();
    jest.advanceTimersByTime(1000);
    b2.onStateExited();
    
    // Should have warned about the new tool
    const newToolWarning = (logger.info as jest.Mock).mock.calls.filter(
      call => call[0].includes('low durability')
    ).length;
    expect(newToolWarning).toBe(1);
    
    (logger.info as jest.Mock).mockClear();

    // Continue using same tool (155, 154, 153 uses...)
    getToolRemainingUses.mockReturnValue(155);
    const b3 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    b3.onStateEntered();
    jest.advanceTimersByTime(1000);
    b3.onStateExited();
    
    getToolRemainingUses.mockReturnValue(154);
    const b4 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    b4.onStateEntered();
    jest.advanceTimersByTime(1000);
    b4.onStateExited();

    // No more warnings because we already warned about this tool at 156 uses
    const spamCheck = (logger.info as jest.Mock).mock.calls.filter(
      call => call[0].includes('low durability')
    ).length;
    expect(spamCheck).toBe(0);
  });
});

