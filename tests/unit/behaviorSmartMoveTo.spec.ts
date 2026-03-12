import { Vec3 } from 'vec3';

class MockBehaviorMoveTo {
  stateName = 'moveTo';
  active = false;
  distance = 1;
  private _isFinished = false;
  private _distanceToTarget = 10;

  constructor(_bot: any, _targets: any) {}

  onStateEntered() { this.active = true; }
  onStateExited() { this.active = false; }
  isFinished() { return this._isFinished; }
  distanceToTarget() { return this._distanceToTarget; }

  setFinished(val: boolean) { this._isFinished = val; }
  setDistanceToTarget(val: number) { this._distanceToTarget = val; }
}

let mockMoveTo: MockBehaviorMoveTo | null = null;
const mockMoveToInstances: MockBehaviorMoveTo[] = [];

jest.mock('mineflayer-statemachine', () => ({
  BehaviorMoveTo: jest.fn().mockImplementation((bot: any, targets: any) => {
    mockMoveTo = new MockBehaviorMoveTo(bot, targets);
    mockMoveToInstances.push(mockMoveTo);
    return mockMoveTo;
  })
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../utils/movementConfig', () => ({
  getStuckDetectionWindowMs: jest.fn().mockReturnValue(10000)
}));

import { BehaviorSmartMoveTo } from '../../behaviors/behaviorSmartMoveTo';
import logger from '../../utils/logger';

describe('BehaviorSmartMoveTo', () => {
  let bot: any;
  let targets: any;
  let behavior: BehaviorSmartMoveTo;

  beforeEach(() => {
    jest.useFakeTimers();
    mockMoveTo = null;
    mockMoveToInstances.length = 0;

    bot = {
      entity: {
        position: new Vec3(0, 60, 0)
      }
    };
    targets = {
      position: new Vec3(10, 60, 0)
    };

    behavior = new BehaviorSmartMoveTo(bot, targets);
  });

  afterEach(() => {
    behavior.onStateExited();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('basic behavior', () => {
    it('delegates isFinished to moveTo when not gave up', () => {
      behavior.onStateEntered();
      expect(behavior.isFinished()).toBe(false);
      // Advance past pathfinding settle guard (MIN_SETTLE_MS = 600)
      jest.advanceTimersByTime(700);
      mockMoveTo!.setFinished(true);
      expect(behavior.isFinished()).toBe(true);
    });

    it('delegates distanceToTarget to moveTo', () => {
      behavior.onStateEntered();
      mockMoveTo!.setDistanceToTarget(5.5);
      expect(behavior.distanceToTarget()).toBe(5.5);
    });

    it('starts stuck detection interval on state entered', () => {
      behavior.onStateEntered();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Started stuck detection interval')
      );
    });

    it('clears interval on state exited', () => {
      behavior.onStateEntered();
      behavior.onStateExited();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cleared stuck detection interval')
      );
    });
  });

  describe('stuck detection', () => {
    it('detects stuck when bot has not moved enough within the window', () => {
      behavior.onStateEntered();

      // Advance 11 seconds without moving the bot
      for (let i = 0; i < 11; i++) {
        jest.advanceTimersByTime(1000);
      }

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Bot is stuck!')
      );
    });

    it('does not detect stuck when bot has moved', () => {
      behavior.onStateEntered();

      // Move the bot significantly between checks
      for (let i = 0; i < 11; i++) {
        bot.entity.position = new Vec3(i * 3, 60, 0);
        jest.advanceTimersByTime(1000);
      }

      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('Bot is stuck!')
      );
    });

    it('initiates unstick when stuck is detected', () => {
      behavior.onStateEntered();

      for (let i = 0; i < 11; i++) {
        jest.advanceTimersByTime(1000);
      }

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Moving to unstick position')
      );
    });
  });

  describe('unstick loop limit', () => {
    function triggerStuck() {
      // Need enough time for the stuck detection window (10s)
      for (let i = 0; i < 11; i++) {
        jest.advanceTimersByTime(1000);
      }
    }

    it('gives up after MAX_UNSTICK_ATTEMPTS when repeatedly stuck', () => {
      behavior.onStateEntered();

      // First stuck detection → unstick attempt 1
      triggerStuck();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Moving to unstick position')
      );

      // Still stuck while unsticking → unstick attempts 2-5
      triggerStuck();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Still stuck while unsticking')
      );
      triggerStuck();
      triggerStuck();
      triggerStuck();

      // Still stuck → should give up (5 attempts exhausted)
      triggerStuck();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Gave up after 5 unstick attempts')
      );
    });

    it('isFinished returns true after giving up', () => {
      behavior.onStateEntered();

      // Even if moveTo says not finished, gaveUp should override
      mockMoveTo!.setFinished(false);

      // Trigger stuck + 5 failed unstick attempts + final give-up
      triggerStuck(); // stuck → attempt 1
      triggerStuck(); // still stuck → attempt 2
      triggerStuck(); // still stuck → attempt 3
      triggerStuck(); // still stuck → attempt 4
      triggerStuck(); // still stuck → attempt 5
      triggerStuck(); // still stuck → gave up

      expect(behavior.isFinished()).toBe(true);
    });

    it('resets gave up state on re-entry', () => {
      behavior.onStateEntered();

      // Drive to gave up
      for (let i = 0; i < 44; i++) {
        jest.advanceTimersByTime(1000);
      }

      // May or may not have gave up yet, exit and re-enter
      behavior.onStateExited();

      targets.position = new Vec3(20, 60, 0);
      behavior.onStateEntered();

      // Should be fresh - not finished
      expect(behavior.isFinished()).toBe(false);
    });

    it('recovers from unstick when moveTo finishes successfully', () => {
      behavior.onStateEntered();

      // Trigger stuck → starts unsticking
      triggerStuck();

      // Simulate the unstick moveTo finishing (pathfinder reached the unstick target)
      // The latest mockMoveTo is the unstick moveTo
      const unstickMoveTo = mockMoveToInstances[mockMoveToInstances.length - 1];
      unstickMoveTo.setFinished(true);

      // Advance one tick so checkIfStuck runs
      jest.advanceTimersByTime(1000);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Unstick complete, retrying original target')
      );

      // Should NOT have given up
      // The newest moveTo (for original target) is not finished
      const retryMoveTo = mockMoveToInstances[mockMoveToInstances.length - 1];
      retryMoveTo.setFinished(false);
      expect(behavior.isFinished()).toBe(false);
    });
  });
});
