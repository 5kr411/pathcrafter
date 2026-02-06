import { createFakeBot } from '../utils/fakeBot';
import { BehaviorWander } from '../../behaviors/behaviorWander';

jest.mock('mineflayer-pathfinder', () => ({
  goals: {
    GoalXZ: class GoalXZ {
      x: number;
      z: number;
      constructor(x: number, z: number) {
        this.x = x;
        this.z = z;
      }
    },
    GoalNear: class GoalNear {
      x: number;
      y: number;
      z: number;
      range: number;
      constructor(x: number, y: number, z: number, range: number) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.range = range;
      }
    }
  }
}));

describe('BehaviorWander', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sets a pathfinder GoalNear on enter with a range', () => {
    const bot = createFakeBot({ position: { x: 10, y: 64, z: 20 } });
    const setGoalSpy = jest.fn();
    bot.pathfinder.setGoal = setGoalSpy;

    const wander = new BehaviorWander(bot, 128);
    wander.onStateEntered();

    expect(setGoalSpy).toHaveBeenCalledTimes(1);
    const goal = setGoalSpy.mock.calls[0][0];
    expect(goal).toBeDefined();
    expect(typeof goal.x).toBe('number');
    expect(typeof goal.z).toBe('number');
    expect(goal.range).toBe(16);
  });

  it('generates a target at the correct XZ distance from the bot', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const setGoalSpy = jest.fn();
    bot.pathfinder.setGoal = setGoalSpy;

    const distance = 100;
    const wander = new BehaviorWander(bot, distance);
    wander.onStateEntered();

    const goal = setGoalSpy.mock.calls[0][0];
    const actualDist = Math.sqrt(goal.x * goal.x + goal.z * goal.z);
    expect(actualDist).toBeCloseTo(distance, 1);
  });

  it('uses default distance of 128 when not specified', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const setGoalSpy = jest.fn();
    bot.pathfinder.setGoal = setGoalSpy;

    const wander = new BehaviorWander(bot);
    wander.onStateEntered();

    const goal = setGoalSpy.mock.calls[0][0];
    const actualDist = Math.sqrt(goal.x * goal.x + goal.z * goal.z);
    expect(actualDist).toBeCloseTo(128, 1);
  });

  it('finishes when goal_reached event fires', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    bot.pathfinder.setGoal = jest.fn();

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();
    expect(wander.isFinished).toBe(false);

    bot.emit('goal_reached');
    expect(wander.isFinished).toBe(true);
  });

  it('finishes on safety timeout if goal is never reached', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    bot.pathfinder.setGoal = jest.fn();

    const distance = 50;
    const wander = new BehaviorWander(bot, distance);
    wander.onStateEntered();
    expect(wander.isFinished).toBe(false);

    const timeoutMs = distance * 1.5 * 1000;
    jest.advanceTimersByTime(timeoutMs);
    expect(wander.isFinished).toBe(true);
  });

  it('removes goal_reached listener after finishing', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    bot.pathfinder.setGoal = jest.fn();

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();

    const listenersBefore = bot.listenerCount('goal_reached');
    bot.emit('goal_reached');
    const listenersAfter = bot.listenerCount('goal_reached');

    expect(listenersBefore).toBe(1);
    expect(listenersAfter).toBe(0);
  });

  it('cleans up on onStateExited', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    bot.pathfinder.setGoal = jest.fn();
    bot.clearControlStates = jest.fn();

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();
    expect(bot.listenerCount('goal_reached')).toBe(1);

    wander.onStateExited();
    expect(bot.listenerCount('goal_reached')).toBe(0);
    expect(wander.active).toBe(false);
  });

  it('finishes immediately when pathfinder is missing', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    (bot as any).pathfinder = null;

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();
    expect(wander.isFinished).toBe(true);
  });

  it('finishes immediately when bot position is missing', () => {
    const bot = createFakeBot();
    (bot as any).entity = undefined;

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();
    expect(wander.isFinished).toBe(true);
  });

  it('handles setGoal throwing an error', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    bot.pathfinder.setGoal = jest.fn(() => {
      throw new Error('pathfinder error');
    });

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();
    expect(wander.isFinished).toBe(true);
  });

  it('does not finish twice when both goal_reached and timeout fire', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    bot.pathfinder.setGoal = jest.fn();

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();

    bot.emit('goal_reached');
    expect(wander.isFinished).toBe(true);

    const timeoutMs = 50 * 1.5 * 1000;
    jest.advanceTimersByTime(timeoutMs);
    expect(wander.isFinished).toBe(true);
  });

  it('re-sets goal on update when pathfinder is idle after cooldown', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const setGoalSpy = jest.fn();
    bot.pathfinder.setGoal = setGoalSpy;
    bot.pathfinder.isMoving = jest.fn().mockReturnValue(false);

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();
    expect(setGoalSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2001);
    wander.update();

    expect(setGoalSpy).toHaveBeenCalledTimes(2);
    const firstGoal = setGoalSpy.mock.calls[0][0];
    const secondGoal = setGoalSpy.mock.calls[1][0];
    expect(secondGoal.x).toBe(firstGoal.x);
    expect(secondGoal.z).toBe(firstGoal.z);
  });

  it('does not re-set goal on update before cooldown expires', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const setGoalSpy = jest.fn();
    bot.pathfinder.setGoal = setGoalSpy;
    bot.pathfinder.isMoving = jest.fn().mockReturnValue(false);

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();
    expect(setGoalSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    wander.update();

    expect(setGoalSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-set goal on update when pathfinder is still moving', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const setGoalSpy = jest.fn();
    bot.pathfinder.setGoal = setGoalSpy;
    bot.pathfinder.isMoving = jest.fn().mockReturnValue(true);

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();
    expect(setGoalSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(3000);
    wander.update();

    expect(setGoalSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-set goal on update after already finished', () => {
    const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
    const setGoalSpy = jest.fn();
    bot.pathfinder.setGoal = setGoalSpy;
    bot.pathfinder.isMoving = jest.fn().mockReturnValue(false);

    const wander = new BehaviorWander(bot, 50);
    wander.onStateEntered();
    bot.emit('goal_reached');
    expect(wander.isFinished).toBe(true);

    setGoalSpy.mockClear();
    jest.advanceTimersByTime(3000);
    wander.update();

    expect(setGoalSpy).not.toHaveBeenCalled();
  });

  describe('water avoidance', () => {
    it('re-rolls when probe direction finds water', () => {
      const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
      bot.pathfinder.setGoal = jest.fn();

      let rollCount = 0;
      jest.spyOn(Math, 'random').mockImplementation(() => {
        rollCount++;
        return rollCount <= 1 ? 0.0 : 0.5;
      });

      bot.blockAt = jest.fn((pos: any) => {
        const dx = pos.x;
        const dz = pos.z;
        if (Math.abs(dz) < 1 && dx > 0) {
          return { type: 9, name: 'water', position: pos, boundingBox: 'block' };
        }
        return { type: 1, name: 'stone', position: pos, boundingBox: 'block' };
      });

      const wander = new BehaviorWander(bot, 100);
      wander.onStateEntered();

      expect(rollCount).toBeGreaterThan(1);
      expect(wander.isFinished).toBe(false);

      (Math.random as any).mockRestore();
    });

    it('accepts water target after 3 failed attempts (island scenario)', () => {
      const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
      bot.pathfinder.setGoal = jest.fn();

      bot.blockAt = jest.fn((_pos: any) => {
        return { type: 9, name: 'water', position: _pos, boundingBox: 'block' };
      });

      const wander = new BehaviorWander(bot, 100);
      wander.onStateEntered();

      expect(wander.isFinished).toBe(false);
      expect(bot.pathfinder.setGoal).toHaveBeenCalledTimes(1);
    });

    it('picks first direction when probe finds land', () => {
      const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
      const setGoalSpy = jest.fn();
      bot.pathfinder.setGoal = setGoalSpy;

      bot.blockAt = jest.fn((_pos: any) => {
        return { type: 1, name: 'stone', position: _pos, boundingBox: 'block' };
      });

      const wander = new BehaviorWander(bot, 100);
      wander.onStateEntered();

      expect(setGoalSpy).toHaveBeenCalledTimes(1);
    });

    it('steps back from target toward bot to find loaded chunk', () => {
      const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
      bot.pathfinder.setGoal = jest.fn();

      const probedDistances: number[] = [];
      bot.blockAt = jest.fn((pos: any) => {
        const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
        probedDistances.push(Math.round(dist));
        if (dist > 50) {
          return null;
        }
        return { type: 1, name: 'stone', position: pos, boundingBox: 'block' };
      });

      const wander = new BehaviorWander(bot, 100);
      wander.onStateEntered();

      expect(probedDistances.length).toBeGreaterThan(1);
      const firstProbe = probedDistances[0];
      const lastProbe = probedDistances[probedDistances.length - 1];
      expect(firstProbe).toBeGreaterThan(lastProbe);
      expect(wander.isFinished).toBe(false);
    });

    it('accepts direction when all columns are unloaded', () => {
      const bot = createFakeBot({ position: { x: 0, y: 64, z: 0 } });
      bot.pathfinder.setGoal = jest.fn();

      bot.blockAt = jest.fn(() => null);

      const wander = new BehaviorWander(bot, 100);
      wander.onStateEntered();

      expect(wander.isFinished).toBe(false);
      expect(bot.pathfinder.setGoal).toHaveBeenCalledTimes(1);
    });
  });
});
