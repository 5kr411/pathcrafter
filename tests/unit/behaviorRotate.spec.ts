import createRotateState from '../../behaviors/behaviorRotate';
import { createRotationBot } from '../utils/rotationHelpers';
import { withLoggerSpy } from '../utils/stateMachineRunner';

describe('unit: behaviorRotate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(100000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('creates a valid state with required properties', () => {
    const bot = createRotationBot({ yaw: 0, pitch: 0 });
    const targets: any = { targetYaw: Math.PI / 2, targetPitch: 0 };
    const state = createRotateState(bot, targets, 3.0);

    expect(state).toBeDefined();
    expect(typeof state.onStateEntered).toBe('function');
    expect(typeof state.onStateExited).toBe('function');
    expect(state.isFinished).toBe(false);
  });

  test('calls bot.look with force=true during rotation', async () => {
    const bot = createRotationBot({ yaw: 0, pitch: 0 });
    const targets: any = { targetYaw: 0.2, targetPitch: 0 };
    const state = createRotateState(bot, targets, 10.0);

    await withLoggerSpy(async () => {
      state.onStateEntered();
      
      for (let i = 0; i < 20 && !state.isFinished; i++) {
        jest.advanceTimersByTime(50);
        jest.setSystemTime(Date.now() + 50);
        await Promise.resolve();
      }
      
      state.onStateExited?.();
    });

    expect(bot.lookCalls.length).toBeGreaterThanOrEqual(1);
    bot.lookCalls.forEach((call: any) => {
      expect(call.force).toBe(true);
    });
  });

  test('completes immediately when already aligned', async () => {
    const targetYaw = Math.PI / 4;
    const targetPitch = 0.01;
    const bot = createRotationBot({ yaw: targetYaw, pitch: targetPitch });
    const targets: any = { targetYaw, targetPitch };
    const state = createRotateState(bot, targets, 3.0);

    await withLoggerSpy(async () => {
      state.onStateEntered();
    });

    expect(state.isFinished).toBe(true);
  });

  test('handles missing target angles gracefully', () => {
    const bot = createRotationBot({ yaw: 0, pitch: 0 });
    const targets: any = {};
    const state = createRotateState(bot, targets, 3.0);

    state.onStateEntered();

    expect(state.isFinished).toBe(true);
  });

  test('handles missing bot entity gracefully', () => {
    const bot = createRotationBot({ yaw: 0, pitch: 0 });
    bot.entity = undefined;
    const targets: any = { targetYaw: 1, targetPitch: 0 };
    const state = createRotateState(bot, targets, 3.0);

    state.onStateEntered();

    expect(state.isFinished).toBe(true);
  });

  test('cleans up interval on state exit', () => {
    const bot = createRotationBot({ yaw: 0, pitch: 0 });
    const targets: any = { targetYaw: Math.PI, targetPitch: 0 };
    const state = createRotateState(bot, targets, 3.0);

    state.onStateEntered();
    expect(state.tickInterval).toBeDefined();
    
    state.onStateExited();
    expect(state.tickInterval).toBeNull();
  });

  test('accepts custom rotation speed', () => {
    const bot = createRotationBot({ yaw: 0, pitch: 0 });
    const targets: any = { targetYaw: 1, targetPitch: 0 };
    const state = createRotateState(bot, targets, 15.0);

    expect(state.rotationSpeed).toBe(15.0);
  });

  test('uses default rotation speed when not specified', () => {
    const bot = createRotationBot({ yaw: 0, pitch: 0 });
    const targets: any = { targetYaw: 1, targetPitch: 0 };
    const state = createRotateState(bot, targets);

    expect(state.rotationSpeed).toBe(6.0);
  });

  test('takes shortest path across -π/π boundary', async () => {
    // Start near +π and target near -π
    // Shortest path is ~0.3 radians, long way is ~6 radians
    const bot = createRotationBot({ yaw: 3.0, pitch: 0 });
    const targets: any = { targetYaw: -3.0, targetPitch: 0 };
    const state = createRotateState(bot, targets, 10.0);

    await withLoggerSpy(async () => {
      state.onStateEntered();
    });

    // Total distance should be the short path (~0.28 radians)
    expect(state.totalDistance).toBeLessThan(1.0);
    expect(state.totalDistance).toBeGreaterThan(0.2);
    
    // Estimated duration should reflect the short path
    // At 10 rad/s, 0.28 radians should take ~28ms
    expect(state.estimatedDuration).toBeLessThan(100);
  });

  test('takes shortest path from negative to positive angle', async () => {
    // Start near -π and target near +π
    const bot = createRotationBot({ yaw: -2.8, pitch: 0 });
    const targets: any = { targetYaw: 2.8, targetPitch: 0 };
    const state = createRotateState(bot, targets, 10.0);

    await withLoggerSpy(async () => {
      state.onStateEntered();
    });

    // Should take short path (~0.6 radians) not long path (~5.6 radians)
    expect(state.totalDistance).toBeLessThan(1.0);
    expect(state.totalDistance).toBeGreaterThan(0.5);
  });

  test('adjusts target angles for shortest path interpolation', async () => {
    // Start at 3.0 (near +π), target -3.0 (near -π)
    const bot = createRotationBot({ yaw: 3.0, pitch: 0 });
    const targets: any = { targetYaw: -3.0, targetPitch: 0 };
    const state = createRotateState(bot, targets, 10.0);

    await withLoggerSpy(async () => {
      state.onStateEntered();
    });

    // After initialization, check that target angles were adjusted
    // for shortest path interpolation
    // Original target was -3.0, but for shortest path from 3.0,
    // it should be adjusted to ~3.28 (which is -3.0 + 2π)
    expect(state.startYaw).toBeCloseTo(3.0, 1);
    
    // Target should have been adjusted to be on the same "side" as start
    // so the interpolation goes the short way
    expect(state.targetYaw).toBeGreaterThan(3.0);
    
    // Distance should be small (short path)
    expect(state.totalDistance).toBeLessThan(1.0);
  });
});
