import { ReactiveTestHarness, createSimulatedBot } from '../helpers/reactiveTestHarness';
import {
  foodSmeltingBehavior,
  resetFoodSmeltingCooldown,
  setFoodSmeltingCooldown
} from '../../bots/collector/reactive_behaviors/food_smelting_behavior';
import { foodCollectionBehavior, resetFoodCollectionCooldown } from '../../bots/collector/reactive_behaviors/food_collection_behavior';

jest.mock('../../planner', () => ({
  plan: jest.fn(),
  _internals: {
    enumerateActionPathsGenerator: jest.fn()
  }
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn(),
  _internals: {
    logActionPath: jest.fn()
  }
}));

jest.mock('../../utils/adaptiveSnapshot', () => ({
  captureAdaptiveSnapshot: jest.fn()
}));

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behaviors/behaviorGetFood', () => ({
  __esModule: true,
  default: jest.fn()
}));

const plannerMock = require('../../planner').plan as jest.Mock;
const enumerateActionPathsGenerator = require('../../planner')._internals.enumerateActionPathsGenerator as jest.Mock;
const buildStateMachineForPath = require('../../behavior_generator/buildMachine').buildStateMachineForPath as jest.Mock;
const captureAdaptiveSnapshot = require('../../utils/adaptiveSnapshot').captureAdaptiveSnapshot as jest.Mock;
const captureSnapshotForTarget = require('../../bots/collector/snapshot_manager').captureSnapshotForTarget as jest.Mock;
const createGetFoodState = require('../../behaviors/behaviorGetFood').default as jest.Mock;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createBotWithRawFood(rawFood: Record<string, number> = {}): any {
  const items: any[] = [];
  for (const [name, count] of Object.entries(rawFood)) {
    if (count > 0) {
      items.push({ name, count, type: 1 });
    }
  }
  
  const slots = new Array(46).fill(null);
  items.forEach((item, i) => {
    slots[i] = item;
  });
  
  return createSimulatedBot({
    position: { x: 0, y: 64, z: 0 },
    inventory: { slots, items },
    food: 20
  });
}

describe('integration: food smelting behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.clearAllMocks();
    resetFoodSmeltingCooldown();
    resetFoodCollectionCooldown();
    captureSnapshotForTarget.mockResolvedValue({ snapshot: { radius: 16 } });
    captureAdaptiveSnapshot.mockResolvedValue({
      snapshot: { radius: 32 },
      radiusUsed: 32,
      attemptsCount: 1
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('has lower priority than food collection (40 vs 60)', () => {
    expect(foodSmeltingBehavior.priority).toBe(40);
    expect(foodCollectionBehavior.priority).toBe(60);
    expect(foodSmeltingBehavior.priority).toBeLessThan(foodCollectionBehavior.priority);
  });

  it('activates when raw food is in inventory', async () => {
    const bot = createBotWithRawFood({ beef: 5 });
    
    const shouldActivate = await Promise.resolve(foodSmeltingBehavior.shouldActivate(bot));
    expect(shouldActivate).toBe(true);
  });

  it('does not activate when no raw food is in inventory', async () => {
    const bot = createBotWithRawFood({});
    
    const shouldActivate = await Promise.resolve(foodSmeltingBehavior.shouldActivate(bot));
    expect(shouldActivate).toBe(false);
  });

  it('runs smelting behavior and completes successfully', async () => {
    const bot = createBotWithRawFood({ beef: 3 });
    
    let smeltTicks = 0;
    let smeltFinished = false;
    
    plannerMock.mockReturnValue({ children: [] });
    enumerateActionPathsGenerator.mockImplementation(function* () {
      yield [
        { action: 'smelt', what: 'cooked_beef', count: 3 }
      ];
    });
    
    buildStateMachineForPath.mockImplementation((_bot: any, _path: any[], onFinished?: (success: boolean) => void) => {
      const stateMachine: any = {
        update: () => {
          smeltTicks += 1;
          if (smeltTicks >= 3) {
            smeltFinished = true;
            if (onFinished) onFinished(true);
          }
        },
        isFinished: () => smeltFinished,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
      return stateMachine;
    });
    
    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    harness.registry.register(foodSmeltingBehavior);
    harness.enableReactivePolling();
    
    try {
      await harness.waitFor(() => harness.manager.isActive(), 1000);
      expect(harness.manager.isActive()).toBe(true);
      
      // Run until smelting completes
      await harness.waitFor(() => smeltFinished, 2000);
      
      expect(smeltTicks).toBeGreaterThan(0);
      expect(buildStateMachineForPath).toHaveBeenCalled();
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('food collection preempts food smelting due to higher priority', async () => {
    // Create bot with raw food but low hunger (to trigger food collection)
    const bot = createBotWithRawFood({ beef: 3 });
    bot.food = 5; // Low food to trigger food collection
    
    // Mock food collection behavior to create a state
    createGetFoodState.mockImplementation(() => {
      const stateMachine: any = {
        update: () => {
          // Food collection is active
        },
        isFinished: () => false,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
      return stateMachine;
    });
    
    // Mock smelting to return a state
    plannerMock.mockReturnValue({ children: [] });
    enumerateActionPathsGenerator.mockImplementation(function* () {
      yield [{ action: 'smelt', what: 'cooked_beef', count: 3 }];
    });
    buildStateMachineForPath.mockImplementation(() => {
      return {
        update: jest.fn(),
        isFinished: () => false,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
    });
    
    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    
    // Register both behaviors
    harness.registry.register(foodCollectionBehavior);
    harness.registry.register(foodSmeltingBehavior);
    harness.enableReactivePolling();
    
    try {
      await harness.waitFor(() => harness.manager.isActive(), 1000);
      
      // Food collection should activate first due to higher priority
      await harness.tick(5);
      await flushMicrotasks();
      
      // createGetFoodState should have been called (food collection)
      expect(createGetFoodState).toHaveBeenCalled();
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('applies cooldown when planning fails', async () => {
    jest.useRealTimers();
    
    const bot = createBotWithRawFood({ beef: 5 });
    
    setFoodSmeltingCooldown(100);
    resetFoodSmeltingCooldown();
    
    // Mock planner to fail
    plannerMock.mockReturnValue(null);
    
    // First check - should activate
    expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(true);
    
    // Create state (which will fail)
    const state = await foodSmeltingBehavior.createState(bot);
    expect(state).toBeNull();
    
    // Should now be in cooldown
    expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(false);
    
    // Wait for cooldown
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Should activate again
    expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(true);
    
    jest.useFakeTimers();
  });

  it('plans for cooked food with correct target count', async () => {
    const bot = createBotWithRawFood({ porkchop: 7 });
    
    plannerMock.mockReturnValue({ children: [] });
    enumerateActionPathsGenerator.mockImplementation(function* () {
      yield [{ action: 'smelt', what: 'cooked_porkchop', count: 7 }];
    });
    buildStateMachineForPath.mockImplementation(() => ({
      update: jest.fn(),
      isFinished: () => false,
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      transitions: [],
      states: []
    }));
    
    await foodSmeltingBehavior.createState(bot);
    
    expect(plannerMock).toHaveBeenCalled();
    const plannerCall = plannerMock.mock.calls[0];
    expect(plannerCall[1]).toBe('cooked_porkchop');
    expect(plannerCall[2]).toBe(7);
  });
});
