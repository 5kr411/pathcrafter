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

describe('Durability Spam Across Multiple States - BUG REPRODUCTION', () => {
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

    getToolRemainingUses.mockReturnValue(10);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('FIXED: INFO logs only ONCE even across MULTIPLE state instances', () => {
    // This test verifies the fix: globalDurabilityWarnings tracks warnings
    // across ALL BehaviorSmartMoveTo instances, not just per-instance

    // First state - mining oak logs during tool replacement
    const behavior1 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    behavior1.onStateEntered();
    jest.advanceTimersByTime(1000);
    
    const firstWarnings = (logger.info as jest.Mock).mock.calls.filter(
      call => call[0].includes('low durability')
    ).length;
    expect(firstWarnings).toBe(1);

    behavior1.onStateExited();
    (logger.info as jest.Mock).mockClear();

    // Second state - mining diamonds during tool replacement
    const behavior2 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    behavior2.onStateEntered();
    jest.advanceTimersByTime(1000);

    const secondWarnings = (logger.info as jest.Mock).mock.calls.filter(
      call => call[0].includes('low durability')
    ).length;
    
    // FIXED: No log because we already warned about this tool in the first state
    expect(secondWarnings).toBe(0);

    behavior2.onStateExited();
    (logger.info as jest.Mock).mockClear();

    // Third state - back to main task
    const behavior3 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    behavior3.onStateEntered();
    jest.advanceTimersByTime(1000);

    const thirdWarnings = (logger.info as jest.Mock).mock.calls.filter(
      call => call[0].includes('low durability')
    ).length;
    
    // FIXED: Still no log - already warned once
    expect(thirdWarnings).toBe(0);
  });

  it('EXPECTED: Should only log ONCE per tool across ALL states', () => {
    // What we WANT: track warnings globally, not per-instance
    // After fixing, this test should pass

    const behavior1 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    behavior1.onStateEntered();
    jest.advanceTimersByTime(1000);
    behavior1.onStateExited();

    const behavior2 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    behavior2.onStateEntered();
    jest.advanceTimersByTime(1000);
    behavior2.onStateExited();

    const behavior3 = new BehaviorSmartMoveTo(mockBot, mockTargets);
    behavior3.onStateEntered();
    jest.advanceTimersByTime(1000);
    behavior3.onStateExited();

    const totalWarnings = (logger.info as jest.Mock).mock.calls.filter(
      call => call[0].includes('low durability')
    ).length;

    // Should only warn ONCE total, not once per instance
    expect(totalWarnings).toBeLessThanOrEqual(1);
  });
});

