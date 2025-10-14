// Stub BehaviorMoveTo to avoid minecraft-data/pathfinder dependency in unit tests
jest.mock('mineflayer-statemachine', () => {
  const real = jest.requireActual('mineflayer-statemachine');
  class BehaviorMoveToMock {
    stateName = 'moveTo';
    active = false;
    constructor(_bot: any, _targets: any) {}
    onStateEntered() {}
    onStateExited() {}
    isFinished() { return true; }
    distanceToTarget() { return 0; }
  }
  return Object.assign({}, real, { BehaviorMoveTo: BehaviorMoveToMock, globalSettings: (real as any).globalSettings || { debugMode: false } });
});

import createPlaceNearState from '../../behaviors/behaviorPlaceNear';
import { createFakeBot } from '../utils/fakeBot';
import { runWithFakeClock, withLoggerSpy } from '../utils/stateMachineRunner';

describe('unit: behaviorPlaceNear', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('reposition when reference base missing after move', async () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const targets: any = { item: { name: 'stone' } };
    const sm = createPlaceNearState(bot as any, targets);

    await withLoggerSpy(async (_logger) => {
      await runWithFakeClock(bot as any, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
  });

  test('move timeout triggers reposition', async () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    // Keep pathfinder moving forever to trigger timeout branch
    (bot.pathfinder as any).isMoving = () => true;
    const targets: any = { item: { name: 'stone' } };
    const sm = createPlaceNearState(bot as any, targets);

    await withLoggerSpy(async (_logger) => {
      await runWithFakeClock(bot as any, sm, { maxMs: 9000, stepMs: 100, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
  });

  test('hard cap exit fires when attempts/time exceed thresholds', async () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const targets: any = { item: { name: 'stone' } };
    const sm = createPlaceNearState(bot as any, targets);

    await withLoggerSpy(async (logger) => {
      await runWithFakeClock(bot as any, sm, { maxMs: 35000, stepMs: 250, directNested: true });
      const errors = (logger as any).error as jest.Mock;
      const messages = errors.mock.calls.map((c: any[]) => String(c[0]));
      expect(messages.some((m: string) => m.includes('hard cap'))).toBeTruthy();
    });

    expect((sm as any).isFinished()).toBe(true);
  });
});


