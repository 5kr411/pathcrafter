import { createFakeBot } from '../utils/fakeBot';
import createBaritoneMoveToState from '../../behaviors/behaviorBaritoneMoveTo';

jest.mock('@miner-org/mineflayer-baritone', () => ({
  goals: {
    GoalExact: class GoalExact {
      pos: any;
      constructor(pos: any) {
        this.pos = pos;
      }
    },
    GoalNear: class GoalNear {
      pos: any;
      range: number;
      constructor(pos: any, range: number) {
        this.pos = pos;
        this.range = range;
      }
    },
    GoalYLevel: class GoalYLevel {
      y: number;
      constructor(y: number) {
        this.y = y;
      }
    },
    GoalXZ: class GoalXZ {
      x: number;
      z: number;
      constructor(x: number, z: number) {
        this.x = x;
        this.z = z;
      }
    }
  }
}));

describe('unit: behaviorBaritoneMoveTo', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should succeed when baritone reaches goal', async () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 }, baritoneSuccess: true });
    const targets: any = { position: { x: 10, y: 64, z: 10 } };

    const baritoneMove = createBaritoneMoveToState(bot as any, targets);
    baritoneMove.onStateEntered();

    await jest.advanceTimersByTimeAsync(100);

    expect(baritoneMove.isFinished()).toBe(true);
    expect(baritoneMove.didSucceed()).toBe(true);
  });

  test('should fail when baritone cannot reach goal', async () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 }, baritoneSuccess: false });
    const targets: any = { position: { x: 10, y: 64, z: 10 } };

    const baritoneMove = createBaritoneMoveToState(bot as any, targets);
    baritoneMove.onStateEntered();

    await jest.advanceTimersByTimeAsync(100);

    expect(baritoneMove.isFinished()).toBe(true);
    expect(baritoneMove.didFail()).toBe(true);
  });

  test('should have timeout configuration', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    
    const targets: any = { 
      position: { x: 10, y: 64, z: 10 },
      baritoneTimeout: 5000
    };

    const baritoneMove = createBaritoneMoveToState(bot as any, targets);
    
    expect(baritoneMove).toBeDefined();
  });

  test('should fail if ashfinder is not available', async () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 }, mockBaritone: false });
    const targets: any = { position: { x: 10, y: 64, z: 10 } };

    const baritoneMove = createBaritoneMoveToState(bot as any, targets);
    baritoneMove.onStateEntered();

    expect(baritoneMove.isFinished()).toBe(true);
    expect(baritoneMove.didFail()).toBe(true);
  });
});

