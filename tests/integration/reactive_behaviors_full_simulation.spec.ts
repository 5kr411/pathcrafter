import { ReactiveTestHarness, createSimulatedBot } from '../helpers/reactiveTestHarness';
import { hostileMobBehavior } from '../../bots/collector/reactive_behaviors/hostile_mob_behavior';
import { shieldDefenseBehavior } from '../../bots/collector/reactive_behaviors/shield_defense_behavior';
import { armorUpgradeBehavior, resetArmorUpgradeCooldowns } from '../../bots/collector/reactive_behaviors/armor_upgrade_behavior';
import {
  foodCollectionBehavior,
  resetFoodCollectionConfig,
  resetFoodCollectionCooldown,
  setFoodCollectionConfig,
  setFoodCollectionCooldown
} from '../../bots/collector/reactive_behaviors/food_collection_behavior';
import { foodEatingBehavior, resetFoodEatingCooldown } from '../../bots/collector/reactive_behaviors/food_eating_behavior';

jest.mock('../../behaviors/behaviorHuntEntity', () => ({
  __esModule: true,
  default: jest.fn(),
  getFailedTargetCooldownRemaining: jest.fn(() => 0)
}));

jest.mock('../../behaviors/behaviorGetFood', () => ({
  __esModule: true,
  default: jest.fn()
}));

jest.mock('../../behaviors/behaviorShieldDefense', () => ({
  createShieldDefenseState: jest.fn()
}));

jest.mock('../../utils/adaptiveSnapshot', () => ({
  captureAdaptiveSnapshot: jest.fn()
}));

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn(),
  _internals: {
    logActionPath: jest.fn()
  }
}));

const createHuntEntityState = require('../../behaviors/behaviorHuntEntity').default as jest.Mock;
const createGetFoodState = require('../../behaviors/behaviorGetFood').default as jest.Mock;
const createShieldDefenseState = require('../../behaviors/behaviorShieldDefense').createShieldDefenseState as jest.Mock;
const captureAdaptiveSnapshot = require('../../utils/adaptiveSnapshot').captureAdaptiveSnapshot as jest.Mock;
const captureSnapshotForTarget = require('../../bots/collector/snapshot_manager').captureSnapshotForTarget as jest.Mock;
const buildStateMachineForPath = require('../../behavior_generator/buildMachine').buildStateMachineForPath as jest.Mock;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForPlanningRequest(harness: ReactiveTestHarness, itemName: string, retries = 10): Promise<any> {
  for (let i = 0; i < retries; i += 1) {
    const record = harness.workerManager.findByItem(itemName);
    if (record) {
      return record;
    }
    // eslint-disable-next-line no-await-in-loop
    await harness.tick(1);
  }
  return null;
}

async function setupBaseTarget(harness: ReactiveTestHarness, baseTicks: { count: number }, itemName = 'oak_log'): Promise<void> {
  buildStateMachineForPath.mockImplementation(() => ({
    update: jest.fn(() => {
      baseTicks.count += 1;
    }),
    onStateEntered: jest.fn(),
    onStateExited: jest.fn(),
    transitions: [],
    states: []
  }));

  const targetExecutor = harness.controlStack.targetLayer;
  targetExecutor.setTargets([{ item: itemName, count: 1 }]);
  await targetExecutor.startNextTarget();
  await flushMicrotasks();

  const request = await waitForPlanningRequest(harness, itemName);
  expect(request).not.toBeNull();
  harness.workerManager.resolve(request!.id, [[{ action: 'mine', what: itemName }]]);

  await harness.tick(2);
  await harness.waitFor(() => baseTicks.count > 0, 1000);
}

describe('integration: full reactive behavior simulation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.clearAllMocks();
    resetArmorUpgradeCooldowns();
    resetFoodCollectionConfig();
    resetFoodCollectionCooldown();
    resetFoodEatingCooldown();
    captureSnapshotForTarget.mockResolvedValue({ snapshot: { radius: 16 } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs hostile mob behavior and resumes the base target', async () => {
    const bot = createSimulatedBot();
    const mobPos = bot.entity.position.clone().offset(3, 0, 0);
    bot.entities = {
      zombie: { name: 'zombie', position: mobPos, health: 20 }
    };

    let huntTicks = 0;
    createHuntEntityState.mockImplementation(() => {
      const stateMachine: any = {
        update: () => {
          huntTicks += 1;
          if (huntTicks >= 4) {
            stateMachine._finished = true;
            bot.entities = {};
          }
        },
        isFinished: () => !!stateMachine._finished,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
      return stateMachine;
    });

    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const baseTicks = { count: 0 };
    await setupBaseTarget(harness, baseTicks);

    expect(await Promise.resolve(hostileMobBehavior.shouldActivate(bot))).toBe(true);

    harness.registry.register(hostileMobBehavior);
    harness.enableReactivePolling();

    try {
      await harness.waitFor(() => createHuntEntityState.mock.calls.length > 0, 1000);
      const baseAtStart = baseTicks.count;

      await harness.advance(50);
      expect(baseTicks.count).toBeLessThanOrEqual(baseAtStart + 1);

      await harness.waitFor(() => !harness.manager.isActive(), 2000);
      expect(huntTicks).toBeGreaterThan(0);

      await harness.waitFor(() => baseTicks.count > baseAtStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('runs shield defense behavior, raises shield, and returns control', async () => {
    const slots = new Array(46).fill(null);
    slots[45] = { name: 'shield', count: 1 };

    const bot = createSimulatedBot({ inventory: { slots } });
    const creeperPos = bot.entity.position.clone().offset(2, 0, 0);
    bot.entities = {
      creeper: { name: 'creeper', position: creeperPos, health: 20 }
    };

    createShieldDefenseState.mockImplementation((_bot: any, config: any) => {
      const stateMachine: any = {
        update: () => {
          stateMachine._ticks = (stateMachine._ticks ?? 0) + 1;
          if (stateMachine._ticks === 1) {
            _bot.activateItem(true);
          }
          if (stateMachine._ticks >= 3) {
            stateMachine._finished = true;
            _bot.deactivateItem();
            _bot.entities = {};
            if (typeof config.onFinished === 'function') {
              config.onFinished(true);
            }
          }
        },
        isFinished: () => !!stateMachine._finished,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
      return stateMachine;
    });

    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const baseTicks = { count: 0 };
    await setupBaseTarget(harness, baseTicks);

    expect(await Promise.resolve(shieldDefenseBehavior.shouldActivate(bot))).toBe(true);

    harness.registry.register(shieldDefenseBehavior);
    harness.enableReactivePolling();

    try {
      await harness.waitFor(() => harness.manager.isActive(), 1000);
      const baseAtStart = baseTicks.count;

      await harness.advance(50);
      expect(baseTicks.count).toBeLessThanOrEqual(baseAtStart + 1);
      expect(bot.activateItem).toHaveBeenCalled();

      await harness.waitFor(() => !harness.manager.isActive(), 2000);
      expect(bot.deactivateItem).toHaveBeenCalled();

      await harness.waitFor(() => baseTicks.count > baseAtStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('equips upgraded armor and resumes the base target', async () => {
    const slots = new Array(46).fill(null);
    slots[9] = { name: 'iron_helmet', count: 1, durabilityUsed: 0, type: 306 };

    const bot = createSimulatedBot({ inventory: { slots } });
    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const baseTicks = { count: 0 };
    await setupBaseTarget(harness, baseTicks);

    expect(await Promise.resolve(armorUpgradeBehavior.shouldActivate(bot))).toBe(true);

    harness.registry.register(armorUpgradeBehavior);
    harness.enableReactivePolling();

    try {
      await harness.waitFor(() => harness.manager.isActive(), 1000);
      const baseAtStart = baseTicks.count;

      await harness.advance(200);
      await harness.waitFor(() => !harness.manager.isActive(), 2000);

      expect(bot.equip).toHaveBeenCalledWith(expect.objectContaining({ name: 'iron_helmet' }), 'head');
      expect(bot.inventory.slots[5]?.name).toBe('iron_helmet');

      await harness.waitFor(() => baseTicks.count > baseAtStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('equips shield to off-hand when available', async () => {
    const slots = new Array(46).fill(null);
    slots[9] = { name: 'shield', count: 1 };

    const bot = createSimulatedBot({ inventory: { slots } });
    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const baseTicks = { count: 0 };
    await setupBaseTarget(harness, baseTicks);

    expect(await Promise.resolve(armorUpgradeBehavior.shouldActivate(bot))).toBe(true);

    harness.registry.register(armorUpgradeBehavior);
    harness.enableReactivePolling();

    try {
      await harness.waitFor(() => harness.manager.isActive(), 1000);
      const baseAtStart = baseTicks.count;

      await harness.advance(200);
      await harness.waitFor(() => !harness.manager.isActive(), 2000);

      expect(bot.equip).toHaveBeenCalledWith(expect.objectContaining({ name: 'shield' }), 'off-hand');
      expect(bot.inventory.slots[45]?.name).toBe('shield');

      await harness.waitFor(() => baseTicks.count > baseAtStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('applies armor upgrade cooldown when equip fails', async () => {
    const slots = new Array(46).fill(null);
    slots[9] = { name: 'iron_helmet', count: 1, durabilityUsed: 0, type: 306 };

    const bot = createSimulatedBot({ inventory: { slots } });
    bot.equip = jest.fn(async () => {
      throw new Error('equip failed');
    });

    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const baseTicks = { count: 0 };
    await setupBaseTarget(harness, baseTicks);

    expect(await Promise.resolve(armorUpgradeBehavior.shouldActivate(bot))).toBe(true);

    harness.registry.register(armorUpgradeBehavior);
    harness.enableReactivePolling();

    try {
      await harness.waitFor(() => harness.manager.isActive(), 1000);
      const baseAtStart = baseTicks.count;

      await harness.advance(200);
      await harness.waitFor(() => !harness.manager.isActive(), 2000);

      expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(false);

      await harness.waitFor(() => !!(armorUpgradeBehavior.shouldActivate(bot) as boolean), 2000);

      await harness.waitFor(() => baseTicks.count > baseAtStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('collects food when inventory is low and resumes base behavior', async () => {
    setFoodCollectionConfig({ triggerFoodPoints: 4, targetFoodPoints: 6 });
    captureAdaptiveSnapshot.mockResolvedValue({ snapshot: { radius: 16 } });

    const slots = new Array(46).fill(null);
    const bot = createSimulatedBot({ inventory: { slots } });

    createGetFoodState.mockImplementation(() => {
      const stateMachine: any = {
        update: () => {
          stateMachine._ticks = (stateMachine._ticks ?? 0) + 1;
          if (stateMachine._ticks === 2) {
            bot.inventory.slots[9] = { name: 'bread', count: 1 };
          }
          if (stateMachine._ticks >= 3) {
            stateMachine._finished = true;
          }
        },
        isFinished: () => !!stateMachine._finished,
        wasSuccessful: () => true,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
      return stateMachine;
    });

    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const baseTicks = { count: 0 };
    await setupBaseTarget(harness, baseTicks);

    expect(await Promise.resolve(foodCollectionBehavior.shouldActivate(bot))).toBe(true);

    harness.registry.register(foodCollectionBehavior);
    harness.enableReactivePolling();

    try {
      await harness.waitFor(() => harness.manager.isActive(), 1000);
      const baseAtStart = baseTicks.count;

      await harness.advance(50);
      expect(baseTicks.count).toBeLessThanOrEqual(baseAtStart + 1);

      await harness.waitFor(() => !harness.manager.isActive(), 2000);
      expect(bot.inventory.slots[9]?.name).toBe('bread');
      expect(bot.safeChat).toHaveBeenCalledWith(expect.stringContaining('low on food'));

      await harness.waitFor(() => baseTicks.count > baseAtStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('honors cooldown when food collection fails to find food', async () => {
    setFoodCollectionConfig({ triggerFoodPoints: 4, targetFoodPoints: 6 });
    setFoodCollectionCooldown(300);
    captureAdaptiveSnapshot.mockResolvedValue({ snapshot: { radius: 16 } });

    const slots = new Array(46).fill(null);
    const bot = createSimulatedBot({ inventory: { slots } });

    createGetFoodState.mockImplementation(() => {
      const stateMachine: any = {
        update: () => {
          stateMachine._ticks = (stateMachine._ticks ?? 0) + 1;
          if (stateMachine._ticks >= 2) {
            stateMachine._finished = true;
          }
        },
        isFinished: () => !!stateMachine._finished,
        wasSuccessful: () => false,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
      return stateMachine;
    });

    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const stateDef = await foodCollectionBehavior.createState(bot);
    expect(stateDef).not.toBeNull();

    const stateMachine = stateDef!.stateMachine;
    if (stateMachine && typeof stateMachine.onStateEntered === 'function') {
      stateMachine.onStateEntered();
    }

    for (let i = 0; i < 3; i += 1) {
      stateMachine.update();
    }

    await harness.advance(50);
    stateDef!.onStop?.('completed');
    expect(foodCollectionBehavior.shouldActivate(bot)).toBe(false);

    await harness.advance(400);
    expect(foodCollectionBehavior.shouldActivate(bot)).toBe(true);
  });

  it('applies cooldown when food gained but still below trigger threshold', async () => {
    setFoodCollectionConfig({ triggerFoodPoints: 10, targetFoodPoints: 20 });
    setFoodCollectionCooldown(300);
    captureAdaptiveSnapshot.mockResolvedValue({ snapshot: { radius: 16 } });

    const slots = new Array(46).fill(null);
    const bot = createSimulatedBot({ inventory: { slots } });

    createGetFoodState.mockImplementation(() => {
      const stateMachine: any = {
        update: () => {
          stateMachine._ticks = (stateMachine._ticks ?? 0) + 1;
          if (stateMachine._ticks === 1) {
            bot.inventory.slots[9] = { name: 'bread', count: 1 };
          }
          if (stateMachine._ticks >= 2) {
            stateMachine._finished = true;
          }
        },
        isFinished: () => !!stateMachine._finished,
        wasSuccessful: () => true,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
      return stateMachine;
    });

    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const stateDef = await foodCollectionBehavior.createState(bot);
    expect(stateDef).not.toBeNull();

    const stateMachine = stateDef!.stateMachine;
    if (stateMachine && typeof stateMachine.onStateEntered === 'function') {
      stateMachine.onStateEntered();
    }

    for (let i = 0; i < 3; i += 1) {
      stateMachine.update();
    }

    await harness.advance(50);
    stateDef!.onStop?.('completed');
    expect(foodCollectionBehavior.shouldActivate(bot)).toBe(false);

    await harness.advance(400);
    expect(foodCollectionBehavior.shouldActivate(bot)).toBe(true);
  });

  it('uses separate trigger and target thresholds for food collection', async () => {
    setFoodCollectionConfig({ triggerFoodPoints: 10, targetFoodPoints: 20 });
    captureAdaptiveSnapshot.mockResolvedValue({ snapshot: { radius: 16 } });

    const items = [
      { name: 'bread', count: 1 },
      { name: 'apple', count: 1 }
    ]; // 5 + 4 = 9
    const bot = createSimulatedBot({ inventory: { items } });

    expect(await Promise.resolve(foodCollectionBehavior.shouldActivate(bot))).toBe(true);

    items.push({ name: 'bread', count: 1 }); // +5 -> 14
    bot.inventory.items = jest.fn().mockReturnValue(items);

    expect(await Promise.resolve(foodCollectionBehavior.shouldActivate(bot))).toBe(false);

    createGetFoodState.mockImplementation(() => ({
      update: jest.fn(),
      isFinished: () => true,
      wasSuccessful: () => true,
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      transitions: [],
      states: []
    }));

    const stateDef = await foodCollectionBehavior.createState(bot);
    expect(stateDef).not.toBeNull();
    expect(createGetFoodState).toHaveBeenCalled();
    const args = createGetFoodState.mock.calls[0][1];
    expect(args.targetFoodPoints).toBe(20);
    expect(args.minFoodThreshold).toBe(10);
  });

  it('eats food, stops current actions, and resumes base behavior', async () => {
    const slots = new Array(46).fill(null);
    slots[9] = { name: 'bread', count: 1 };

    const bot = createSimulatedBot({ inventory: { slots }, food: 15 });
    bot.consume = jest.fn(async () => {
      bot.food = 20;
    });

    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const baseTicks = { count: 0 };
    await setupBaseTarget(harness, baseTicks);

    expect(await Promise.resolve(foodEatingBehavior.shouldActivate(bot))).toBe(true);

    harness.registry.register(foodEatingBehavior);
    harness.enableReactivePolling();

    try {
      await harness.waitFor(() => harness.manager.isActive(), 1000);
      const baseAtStart = baseTicks.count;

      await harness.advance(50);
      expect(baseTicks.count).toBeLessThanOrEqual(baseAtStart + 1);
      expect(bot.clearControlStates).toHaveBeenCalled();
      expect(bot.pathfinder.stop).toHaveBeenCalled();
      expect(bot.stopDigging).toHaveBeenCalled();

      await harness.waitFor(() => !harness.manager.isActive(), 2000);
      expect(bot.consume).toHaveBeenCalled();

      await harness.waitFor(() => baseTicks.count > baseAtStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('backs off after eating timeouts to avoid repeated attempts', async () => {
    const slots = new Array(46).fill(null);
    slots[9] = { name: 'porkchop', count: 1 };

    const bot = createSimulatedBot({ inventory: { slots }, food: 15 });
    bot.consume = jest.fn(async () => {
      throw new Error('Promise timed out.');
    });

    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const baseTicks = { count: 0 };
    await setupBaseTarget(harness, baseTicks);

    expect(await Promise.resolve(foodEatingBehavior.shouldActivate(bot))).toBe(true);

    harness.registry.register(foodEatingBehavior);
    harness.enableReactivePolling();

    try {
      await harness.waitFor(() => bot.consume.mock.calls.length > 0, 1000);
      await harness.waitFor(() => !harness.manager.isActive(), 2000);

      const callsAfterFirst = bot.consume.mock.calls.length;
      await harness.advance(10000);
      expect(bot.consume.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('preempts lower priority food collection with shield defense and returns to food collection', async () => {
    setFoodCollectionConfig({ triggerFoodPoints: 4, targetFoodPoints: 6 });
    captureAdaptiveSnapshot.mockResolvedValue({ snapshot: { radius: 16 } });

    const slots = new Array(46).fill(null);
    slots[9] = { name: 'shield', count: 1 };
    const bot = createSimulatedBot({ inventory: { slots } });

    let foodRuns = 0;
    createGetFoodState.mockImplementation(() => {
      foodRuns += 1;
      const runId = foodRuns;
      const stateMachine: any = {
        update: () => {
          stateMachine._ticks = (stateMachine._ticks ?? 0) + 1;
          if (runId === 2 && stateMachine._ticks === 2) {
            bot.inventory.slots[10] = { name: 'bread', count: 1 };
          }
          if (runId === 2 && stateMachine._ticks >= 3) {
            stateMachine._finished = true;
          }
        },
        isFinished: () => !!stateMachine._finished,
        wasSuccessful: () => runId === 2,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
      return stateMachine;
    });

    createShieldDefenseState.mockImplementation((_bot: any, config: any) => {
      const stateMachine: any = {
        update: () => {
          stateMachine._ticks = (stateMachine._ticks ?? 0) + 1;
          if (stateMachine._ticks === 1) {
            _bot.activateItem(true);
          }
          if (stateMachine._ticks >= 2) {
            stateMachine._finished = true;
            _bot.deactivateItem();
            if (typeof config.onFinished === 'function') {
              config.onFinished(true);
            }
          }
        },
        isFinished: () => !!stateMachine._finished,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
      return stateMachine;
    });

    const harness = new ReactiveTestHarness({ bot, tickMs: 50 });
    const baseTicks = { count: 0 };
    await setupBaseTarget(harness, baseTicks);

    expect(await Promise.resolve(foodCollectionBehavior.shouldActivate(bot))).toBe(true);
    expect(await Promise.resolve(shieldDefenseBehavior.shouldActivate(bot))).toBe(false);

    harness.registry.register(shieldDefenseBehavior);
    harness.registry.register(foodCollectionBehavior);
    harness.enableReactivePolling();

    try {
      await harness.waitFor(() => foodRuns >= 1, 1000);
      const baseAtStart = baseTicks.count;

      await harness.advance(50);
      expect(baseTicks.count).toBeLessThanOrEqual(baseAtStart + 1);

      const creeperPos = bot.entity.position.clone().offset(2, 0, 0);
      bot.entities = {
        creeper: { name: 'creeper', position: creeperPos, health: 20 }
      };

      await harness.waitFor(() => bot.activateItem.mock.calls.length > 0, 1000);
      expect(foodRuns).toBe(1);

      await harness.waitFor(() => bot.deactivateItem.mock.calls.length > 0, 1000);
      bot.entities = {};

      await harness.waitFor(() => foodRuns >= 2, 2000);
      await harness.waitFor(() => !harness.manager.isActive(), 2000);

      expect(bot.inventory.slots[10]?.name).toBe('bread');
      await harness.waitFor(() => baseTicks.count > baseAtStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });
});
