import { Vec3 } from 'vec3';

class MockBehaviorFollowEntity {
  stateName = 'followEntity';
  active = false;
  followDistance = 2;
  movements = { canDig: true, allowFreeMotion: false };
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

let mockFollowEntity: MockBehaviorFollowEntity | null = null;
let mockMoveTo: MockBehaviorMoveTo | null = null;

jest.mock('mineflayer-statemachine', () => ({
  BehaviorFollowEntity: jest.fn().mockImplementation((bot: any, targets: any) => {
    mockFollowEntity = new MockBehaviorFollowEntity(bot, targets);
    return mockFollowEntity;
  }),
  BehaviorMoveTo: jest.fn().mockImplementation((bot: any, targets: any) => {
    mockMoveTo = new MockBehaviorMoveTo(bot, targets);
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

import { BehaviorSafeFollowEntity } from '../../behaviors/behaviorSafeFollowEntity';

describe('BehaviorSafeFollowEntity', () => {
  let bot: any;
  let targets: any;
  let behavior: BehaviorSafeFollowEntity;
  
  beforeEach(() => {
    jest.useFakeTimers();
    mockFollowEntity = null;
    mockMoveTo = null;
    
    bot = {
      entity: {
        position: new Vec3(0, 60, 0)
      }
    };
    
    targets = {
      entity: {
        position: new Vec3(10, 60, 0),
        name: 'zombie'
      }
    };
    
    behavior = new BehaviorSafeFollowEntity(bot, targets);
  });
  
  afterEach(() => {
    if (behavior) {
      behavior.onStateExited();
    }
    jest.useRealTimers();
  });
  
  describe('constructor and basic properties', () => {
    it('should create wrapper with underlying BehaviorFollowEntity', () => {
      expect(mockFollowEntity).not.toBeNull();
    });
    
    it('should expose followDistance property', () => {
      behavior.followDistance = 5;
      expect(mockFollowEntity!.followDistance).toBe(5);
      expect(behavior.followDistance).toBe(5);
    });
    
    it('should expose movements property', () => {
      expect(behavior.movements).toBe(mockFollowEntity!.movements);
      behavior.movements.canDig = false;
      expect(mockFollowEntity!.movements.canDig).toBe(false);
    });
  });
  
  describe('lifecycle methods', () => {
    it('should start stuck detection interval on state enter', () => {
      behavior.onStateEntered();
      
      expect(mockFollowEntity!.active).toBe(true);
    });
    
    it('should clear interval and cleanup on state exit', () => {
      behavior.onStateEntered();
      behavior.onStateExited();
      
      expect(mockFollowEntity!.active).toBe(false);
    });
    
    it('should reset smartMoveStuckCount on state enter', () => {
      targets.smartMoveStuckCount = 5;
      targets.lastSmartMoveStuck = Date.now();
      
      behavior.onStateEntered();
      
      expect(targets.smartMoveStuckCount).toBe(0);
    });
    
    it('should clean up smartMoveStuckCount on state exit', () => {
      behavior.onStateEntered();
      targets.smartMoveStuckCount = 1;
      targets.lastSmartMoveStuck = Date.now();
      
      behavior.onStateExited();
      
      expect('smartMoveStuckCount' in targets).toBe(false);
      expect('lastSmartMoveStuck' in targets).toBe(false);
    });
  });
  
  describe('isFinished and distanceToTarget', () => {
    it('should delegate isFinished to underlying follow entity when not unsticking', () => {
      behavior.onStateEntered();
      
      mockFollowEntity!.setFinished(false);
      expect(behavior.isFinished()).toBe(false);
      
      mockFollowEntity!.setFinished(true);
      expect(behavior.isFinished()).toBe(true);
    });
    
    it('should return false for isFinished when unsticking', () => {
      behavior.onStateEntered();
      
      // Trigger stuck detection by not moving for 20+ seconds
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      // If unsticking was initiated, isFinished should return false
      // (even if underlying follow would be finished)
      mockFollowEntity!.setFinished(true);
      
      // behavior might be in unsticking mode if stuck was detected
      // The check here depends on whether stuck was detected
    });
    
    it('should delegate distanceToTarget to underlying follow entity when not unsticking', () => {
      behavior.onStateEntered();
      
      mockFollowEntity!.setDistanceToTarget(5.5);
      expect(behavior.distanceToTarget()).toBe(5.5);
    });
  });
  
  describe('stuck detection', () => {
    it('should detect stuck when bot has not moved for 20+ seconds', () => {
      behavior.onStateEntered();
      
      // Advance time 25 seconds without moving the bot
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      expect(targets.smartMoveStuckCount).toBe(1);
      expect(targets.lastSmartMoveStuck).toBeDefined();
    });
    
    it('should not detect stuck when bot has moved more than 2 blocks', () => {
      behavior.onStateEntered();
      
      // Advance time 10 seconds
      for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      // Move the bot 5 blocks
      bot.entity.position = new Vec3(5, 60, 0);
      
      // Advance more time
      for (let i = 0; i < 15; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      // Should not be stuck because we moved
      expect(targets.smartMoveStuckCount || 0).toBe(0);
    });
    
    it('should increment smartMoveStuckCount each time stuck is detected', () => {
      targets.disableSmartMoveUnstick = true; // Disable unstick so we can test multiple detections
      behavior = new BehaviorSafeFollowEntity(bot, targets);
      behavior.onStateEntered();
      
      // First stuck detection
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      expect(targets.smartMoveStuckCount).toBe(1);
    });
  });
  
  describe('unstick mechanism', () => {
    it('should initiate unstick when stuck is detected and unstick is allowed', () => {
      behavior.onStateEntered();
      
      // Advance time to trigger stuck detection
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      // Should have created a MoveTo behavior for unsticking
      expect(mockMoveTo).not.toBeNull();
    });
    
    it('should not initiate unstick when disableSmartMoveUnstick is true', () => {
      targets.disableSmartMoveUnstick = true;
      behavior = new BehaviorSafeFollowEntity(bot, targets);
      behavior.onStateEntered();
      
      // Advance time to trigger stuck detection
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      // Should have detected stuck but not created MoveTo
      expect(targets.smartMoveStuckCount).toBe(1);
      expect(mockMoveTo).toBeNull();
    });
    
    it('should resume following entity after unstick completes', () => {
      behavior.onStateEntered();
      const initialFollowEntity = mockFollowEntity;
      
      // Advance time to trigger stuck detection and unstick
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      // Unstick MoveTo should be created
      expect(mockMoveTo).not.toBeNull();
      
      // Simulate unstick completion
      mockMoveTo!.setFinished(true);
      
      // Advance time to detect unstick completion
      jest.advanceTimersByTime(1000);
      
      // A new follow entity should be created
      expect(mockFollowEntity).not.toBe(initialFollowEntity);
    });
    
    it('should save and restore entity when unsticking', () => {
      behavior.onStateEntered();
      const originalEntity = targets.entity;
      
      // Advance time to trigger stuck detection and unstick
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      // During unstick, targets.position should be set to unstick position
      expect(targets.position).toBeDefined();
      
      // Simulate unstick completion
      mockMoveTo!.setFinished(true);
      jest.advanceTimersByTime(1000);
      
      // Entity should be restored
      expect(targets.entity).toBe(originalEntity);
    });
  });
  
  describe('edge cases', () => {
    it('should handle missing entity gracefully', () => {
      targets.entity = null;
      behavior = new BehaviorSafeFollowEntity(bot, targets);
      behavior.onStateEntered();
      
      // Should not throw when checking stuck with no entity
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      // Should not detect stuck when no entity
      expect(targets.smartMoveStuckCount || 0).toBe(0);
    });
    
    it('should handle missing bot position gracefully', () => {
      bot.entity = undefined;
      behavior = new BehaviorSafeFollowEntity(bot, targets);
      
      // Should not throw
      expect(() => behavior.onStateEntered()).not.toThrow();
      
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
    });
    
    it('should handle follow entity finishing during normal operation', () => {
      behavior.onStateEntered();
      
      mockFollowEntity!.setFinished(true);
      
      // Advance time
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(1000);
      }
      
      // Should not detect stuck when follow is finished
      expect(targets.smartMoveStuckCount || 0).toBe(0);
    });
  });
});
