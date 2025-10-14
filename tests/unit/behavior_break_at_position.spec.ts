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

import createBreakAtPositionState from '../../behaviors/behaviorBreakAtPosition';
import { createFakeBot } from '../utils/fakeBot';
import { runWithFakeClock, withLoggerSpy } from '../utils/stateMachineRunner';

function v(x: number, y: number, z: number) {
  return {
    x,
    y,
    z,
    clone: () => v(x, y, z),
    distanceTo: (o: any) => Math.sqrt((x - o.x) ** 2 + (y - o.y) ** 2 + (z - o.z) ** 2),
    floor() { this.x = Math.floor(this.x); this.y = Math.floor(this.y); this.z = Math.floor(this.z); return this; },
    floored: () => v(Math.floor(x), Math.floor(y), Math.floor(z)),
    offset(dx: number, dy: number, dz: number) { this.x += dx; this.y += dy; this.z += dz; return this; }
  } as any;
}

describe('unit: behaviorBreakAtPosition', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('success path: block becomes air -> exit without retries', async () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const pos = v(1, 64, 1);
    const targets: any = { position: pos };
    // Ensure reference block exists then will be dug to air by BehaviorMineBlock
    (bot.world as any).setBlockType(pos, 1);

    const sm = createBreakAtPositionState(bot as any, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, sm, { maxMs: 2000, stepMs: 50, directNested: true });
    });

    // If state machine reached exit successfully, active state should be exit per NestedStateMachine semantics
    expect((sm as any).isFinished()).toBe(true);
  });

  test('retry path: block remains -> at least one retry occurs', async () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const pos = v(2, 64, 2) as any;
    const targets: any = { position: pos };
    // Keep block non-air to force retry logic; prevent dig from succeeding
    (bot.world as any).setBlockType(pos, 1);
    bot.dig = async () => { /* do not change world */ };

    const sm = createBreakAtPositionState(bot as any, targets);

    await withLoggerSpy(async (logger) => {
      await runWithFakeClock(bot as any, sm, { maxMs: 4000, stepMs: 50, directNested: true });
      const infos = (logger as any).info as jest.Mock;
      const retryCount = infos.mock.calls.filter((c: any[]) => String(c[0]).includes('mine -> retry')).length;
      expect(retryCount).toBeGreaterThanOrEqual(1);
    });
  });

  test('timeout path: mining exceeds MINE_TIMEOUT_MS -> exit', async () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const pos = v(3, 64, 3) as any;
    const targets: any = { position: pos };
    (bot.world as any).setBlockType(pos, 1);
    // Prevent dig and keep block solid to trigger timeout branch
    bot.dig = async () => { /* hang */ };

    const sm = createBreakAtPositionState(bot as any, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, sm, { maxMs: 15000, stepMs: 100, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
  });
});


