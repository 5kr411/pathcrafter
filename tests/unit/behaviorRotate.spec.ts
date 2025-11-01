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

    expect(state.rotationSpeed).toBe(3.0);
  });
});
