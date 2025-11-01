import { Vec3 } from 'vec3';

// Mock mineflayer-statemachine
jest.mock('mineflayer-statemachine', () => ({
  StateTransition: jest.fn(),
  BehaviorIdle: jest.fn(),
  BehaviorFollowEntity: jest.fn(),
  BehaviorGetClosestEntity: jest.fn(),
  NestedStateMachine: jest.fn()
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock stateLogging
jest.mock('../../utils/stateLogging', () => ({
  addStateLogging: jest.fn()
}));

// Mock behaviorAttackEntity
jest.mock('../../behaviors/behaviorAttackEntity', () => ({
  __esModule: true,
  default: jest.fn()
}));

describe('behaviorFollowAndAttackEntity - movement detection', () => {
  let bot: any;
  let entity: any;
  
  beforeEach(() => {
    bot = {
      entity: {
        position: new Vec3(0, 60, 0),
        health: 20,
        yaw: 0,
        pitch: 0
      },
      clearControlStates: jest.fn()
    };
    
    entity = {
      position: new Vec3(10, 60, 0),
      health: 20,
      isAlive: () => true
    };
  });

  describe('isEntityApproaching logic', () => {
    function isEntityApproaching(bot: any, entity: any, lastPos: any, currentPos: any): boolean | null {
      if (!bot.entity?.position || !entity?.position || !lastPos || !currentPos) {
        return null;
      }

      // Calculate entity's movement vector
      const movementX = currentPos.x - lastPos.x;
      const movementY = currentPos.y - lastPos.y;
      const movementZ = currentPos.z - lastPos.z;
      const movementMagnitude = Math.sqrt(movementX * movementX + movementY * movementY + movementZ * movementZ);

      // Entity not moving (positions are identical)
      if (movementMagnitude < 0.001) {
        return null;
      }

      // Calculate vector from entity's current position to bot
      const toBotX = bot.entity.position.x - currentPos.x;
      const toBotY = bot.entity.position.y - currentPos.y;
      const toBotZ = bot.entity.position.z - currentPos.z;

      // Dot product: positive = approaching, negative = fleeing
      const dotProduct = (movementX * toBotX) + (movementY * toBotY) + (movementZ * toBotZ);

      return dotProduct > 0;
    }

    it('should detect entity moving towards bot', () => {
      // Entity at x=10 moving to x=8 (towards bot at x=0)
      const lastPos = new Vec3(10, 60, 0);
      const currentPos = new Vec3(8, 60, 0);
      
      const result = isEntityApproaching(bot, entity, lastPos, currentPos);
      
      expect(result).toBe(true);
    });

    it('should detect entity moving away from bot', () => {
      // Entity at x=10 moving to x=12 (away from bot at x=0)
      const lastPos = new Vec3(10, 60, 0);
      const currentPos = new Vec3(12, 60, 0);
      
      const result = isEntityApproaching(bot, entity, lastPos, currentPos);
      
      expect(result).toBe(false);
    });

    it('should return null when entity is not moving', () => {
      // Entity stationary
      const lastPos = new Vec3(10, 60, 0);
      const currentPos = new Vec3(10, 60, 0);
      
      const result = isEntityApproaching(bot, entity, lastPos, currentPos);
      
      expect(result).toBe(null);
    });

    it('should detect small movements towards bot', () => {
      // Entity at x=10 moving to x=9.95 (small movement towards bot at x=0)
      const lastPos = new Vec3(10, 60, 0);
      const currentPos = new Vec3(9.95, 60, 0);
      
      const result = isEntityApproaching(bot, entity, lastPos, currentPos);
      
      expect(result).toBe(true);
    });

    it('should detect small movements away from bot', () => {
      // Entity at x=10 moving to x=10.05 (small movement away from bot at x=0)
      const lastPos = new Vec3(10, 60, 0);
      const currentPos = new Vec3(10.05, 60, 0);
      
      const result = isEntityApproaching(bot, entity, lastPos, currentPos);
      
      expect(result).toBe(false);
    });

    it('should handle entity moving perpendicular to bot', () => {
      // Entity at (10, 60, 0) moving to (10, 60, 1) (perpendicular)
      const lastPos = new Vec3(10, 60, 0);
      const currentPos = new Vec3(10, 60, 1);
      
      const result = isEntityApproaching(bot, entity, lastPos, currentPos);
      
      // Perpendicular movement should not be approaching (dot product ~0, but slightly negative due to distance increase)
      expect(result).toBe(false);
    });
  });

  describe('position tracking across state transitions', () => {
    it('should preserve position history when cloning', () => {
      // Simulate position tracking
      let lastTickPosition: Vec3 | null = null;
      let currentTickPosition: Vec3 | null = null;

      // Initial position
      currentTickPosition = new Vec3(10, 60, 0);
      lastTickPosition = currentTickPosition.clone();

      // Entity moves
      if (currentTickPosition) {
        lastTickPosition = currentTickPosition.clone();
      }
      currentTickPosition = new Vec3(8, 60, 0);

      // Verify they're different objects
      expect(lastTickPosition).not.toBe(currentTickPosition);
      expect(lastTickPosition.x).toBe(10);
      expect(currentTickPosition.x).toBe(8);
    });

    it('should detect movement when positions are properly cloned', () => {
      function isEntityApproaching(bot: any, entity: any, lastPos: any, currentPos: any): boolean | null {
        if (!bot.entity?.position || !entity?.position || !lastPos || !currentPos) {
          return null;
        }

        const movementX = currentPos.x - lastPos.x;
        const movementY = currentPos.y - lastPos.y;
        const movementZ = currentPos.z - lastPos.z;
        const movementMagnitude = Math.sqrt(movementX * movementX + movementY * movementY + movementZ * movementZ);

        if (movementMagnitude < 0.001) {
          return null;
        }

        const toBotX = bot.entity.position.x - currentPos.x;
        const toBotY = bot.entity.position.y - currentPos.y;
        const toBotZ = bot.entity.position.z - currentPos.z;

        const dotProduct = (movementX * toBotX) + (movementY * toBotY) + (movementZ * toBotZ);

        return dotProduct > 0;
      }

      // Simulate tracking loop
      let lastTickPosition: Vec3 | null = null;
      let currentTickPosition: Vec3 | null = null;

      // Tick 1: initialize
      currentTickPosition = new Vec3(10, 60, 0);
      lastTickPosition = currentTickPosition.clone();

      // Tick 2: entity moves towards bot
      if (currentTickPosition) {
        lastTickPosition = currentTickPosition.clone();
      }
      currentTickPosition = new Vec3(8, 60, 0);

      const result = isEntityApproaching(bot, entity, lastTickPosition, currentTickPosition);
      expect(result).toBe(true);
    });

    it('should fail when positions are NOT cloned (reference bug)', () => {
      function isEntityApproaching(bot: any, entity: any, lastPos: any, currentPos: any): boolean | null {
        if (!bot.entity?.position || !entity?.position || !lastPos || !currentPos) {
          return null;
        }

        const movementX = currentPos.x - lastPos.x;
        const movementY = currentPos.y - lastPos.y;
        const movementZ = currentPos.z - lastPos.z;
        const movementMagnitude = Math.sqrt(movementX * movementX + movementY * movementY + movementZ * movementZ);

        if (movementMagnitude < 0.001) {
          return null;
        }

        const toBotX = bot.entity.position.x - currentPos.x;
        const toBotY = bot.entity.position.y - currentPos.y;
        const toBotZ = bot.entity.position.z - currentPos.z;

        const dotProduct = (movementX * toBotX) + (movementY * toBotY) + (movementZ * toBotZ);

        return dotProduct > 0;
      }

      // Simulate BUGGY tracking loop (no clone)
      let lastTickPosition: Vec3 | null = null;
      let currentTickPosition: Vec3 | null = null;

      // Tick 1: initialize
      currentTickPosition = new Vec3(10, 60, 0);
      lastTickPosition = currentTickPosition; // BUG: no clone!

      // Tick 2: entity moves
      lastTickPosition = currentTickPosition; // BUG: reference assignment!
      currentTickPosition = new Vec3(8, 60, 0);

      // Because lastTickPosition and the old currentTickPosition are the same reference,
      // they both point to the same Vec3 object. But currentTickPosition is now a NEW Vec3,
      // so lastTickPosition still points to the old Vec3(10, 60, 0)
      
      // Wait, this might actually work because we're creating a NEW Vec3...
      // The bug is more subtle - it's when we do: lastTickPosition = currentTickPosition
      // then modify currentTickPosition's properties

      // Let me simulate the actual bug:
      currentTickPosition = new Vec3(10, 60, 0);
      lastTickPosition = currentTickPosition; // Same reference

      // Now "update" current by mutating (if mineflayer does this):
      currentTickPosition.x = 8;

      // Now both point to same object with x=8!
      expect(lastTickPosition.x).toBe(8);  // This proves the bug
      expect(currentTickPosition.x).toBe(8);
      
      const result = isEntityApproaching(bot, entity, lastTickPosition, currentTickPosition);
      expect(result).toBe(null); // Movement magnitude is 0, so returns null
    });
  });

  describe('rapid shouldTransition calls (real-world scenario)', () => {
    it('FAILS: current implementation loses position history by updating on every check', () => {
      function isEntityApproaching(bot: any, entity: any, lastPos: any, currentPos: any): boolean | null {
        if (!bot.entity?.position || !entity?.position || !lastPos || !currentPos) {
          return null;
        }

        const movementX = currentPos.x - lastPos.x;
        const movementY = currentPos.y - lastPos.y;
        const movementZ = currentPos.z - lastPos.z;
        const movementMagnitude = Math.sqrt(movementX * movementX + movementY * movementY + movementZ * movementZ);

        if (movementMagnitude < 0.001) {
          return null;
        }

        const toBotX = bot.entity.position.x - currentPos.x;
        const toBotY = bot.entity.position.y - currentPos.y;
        const toBotZ = bot.entity.position.z - currentPos.z;

        const dotProduct = (movementX * toBotX) + (movementY * toBotY) + (movementZ * toBotZ);

        return dotProduct > 0;
      }

      // Simulate entity tracking
      let lastTickPosition: Vec3 | null = null;
      let currentTickPosition: Vec3 | null = null;

      // Simulate entity object that mineflayer updates
      const entityPositionRef = new Vec3(10, 60, 0);
      entity.position = entityPositionRef;

      // Initialize on state entry
      currentTickPosition = entity.position.clone();
      lastTickPosition = currentTickPosition!.clone();

      // THIS IS THE BUG: we update positions on EVERY shouldTransition call
      // Even when entity hasn't moved!
      let detectedMovement: boolean | null = null;
      for (let i = 0; i < 10; i++) {
        // Simulate entity moving once during the loop
        if (i === 5) {
          entityPositionRef.x = 8; // Entity moves towards bot
        }

        // This is what the CURRENT implementation does - updates on every check
        if (currentTickPosition) {
          lastTickPosition = currentTickPosition.clone();
        }
        currentTickPosition = entity.position.clone();
        
        detectedMovement = isEntityApproaching(bot, entity, lastTickPosition, currentTickPosition);
      }

      // By the time we check after position updated, lastTickPosition has ALSO been 
      // updated to the new position (because we called shouldTransition multiple times
      // after the position changed), so they're identical again!
      
      // It will detect movement on the FIRST check after position changes,
      // but then on subsequent checks it becomes null again
      expect(detectedMovement).toBe(null); // After many checks, it's null again
    });

    it('CORRECT: only update lastTickPosition when position actually changes', () => {
      function isEntityApproaching(bot: any, entity: any, lastPos: any, currentPos: any): boolean | null {
        if (!bot.entity?.position || !entity?.position || !lastPos || !currentPos) {
          return null;
        }

        const movementX = currentPos.x - lastPos.x;
        const movementY = currentPos.y - lastPos.y;
        const movementZ = currentPos.z - lastPos.z;
        const movementMagnitude = Math.sqrt(movementX * movementX + movementY * movementY + movementZ * movementZ);

        if (movementMagnitude < 0.001) {
          return null;
        }

        const toBotX = bot.entity.position.x - currentPos.x;
        const toBotY = bot.entity.position.y - currentPos.y;
        const toBotZ = bot.entity.position.z - currentPos.z;

        const dotProduct = (movementX * toBotX) + (movementY * toBotY) + (movementZ * toBotZ);

        return dotProduct > 0;
      }

      // Simulate entity tracking
      let lastTickPosition: Vec3 | null = null;
      let currentTickPosition: Vec3 | null = null;

      // Simulate entity object
      const entityPositionRef = new Vec3(10, 60, 0);
      entity.position = entityPositionRef;

      // Initialize
      if (!lastTickPosition && entity.position) {
        currentTickPosition = entity.position.clone();
        lastTickPosition = currentTickPosition!.clone();
      }

      let detectedMovement: boolean | null = null;

      // THE FIX: Check for position changes BEFORE updating
      for (let i = 0; i < 100; i++) {
        if (i === 50) {
          entityPositionRef.x = 8; // Entity moves
        }

        const newPosition = entity.position.clone();
        
        // Only update lastTickPosition if current position has actually changed
        if (currentTickPosition && 
            (Math.abs(newPosition.x - currentTickPosition.x) > 0.001 ||
             Math.abs(newPosition.y - currentTickPosition.y) > 0.001 ||
             Math.abs(newPosition.z - currentTickPosition.z) > 0.001)) {
          lastTickPosition = currentTickPosition.clone();
          currentTickPosition = newPosition;
        }
        
        detectedMovement = isEntityApproaching(bot, entity, lastTickPosition, currentTickPosition);
      }

      // Should successfully detect movement!
      expect(detectedMovement).toBe(true);
      expect(lastTickPosition!.x).toBe(10);  // Preserved old position
      expect(currentTickPosition!.x).toBe(8); // New position
    });

    it('should eventually detect movement when shouldTransition is called many times per game tick', () => {
      function isEntityApproaching(bot: any, entity: any, lastPos: any, currentPos: any): boolean | null {
        if (!bot.entity?.position || !entity?.position || !lastPos || !currentPos) {
          return null;
        }

        const movementX = currentPos.x - lastPos.x;
        const movementY = currentPos.y - lastPos.y;
        const movementZ = currentPos.z - lastPos.z;
        const movementMagnitude = Math.sqrt(movementX * movementX + movementY * movementY + movementZ * movementZ);

        if (movementMagnitude < 0.001) {
          return null;
        }

        const toBotX = bot.entity.position.x - currentPos.x;
        const toBotY = bot.entity.position.y - currentPos.y;
        const toBotZ = bot.entity.position.z - currentPos.z;

        const dotProduct = (movementX * toBotX) + (movementY * toBotY) + (movementZ * toBotZ);

        return dotProduct > 0;
      }

      // Simulate entity tracking
      let lastTickPosition: Vec3 | null = null;
      let currentTickPosition: Vec3 | null = null;

      // Simulate entity object that mineflayer updates
      const entityPositionRef = new Vec3(10, 60, 0);
      entity.position = entityPositionRef;

      // Initialize on state entry
      currentTickPosition = entity.position.clone();
      lastTickPosition = currentTickPosition!.clone();

      // Simulate shouldTransition being called 100 times while entity position hasn't changed
      let detectedMovement: boolean | null = null;
      for (let i = 0; i < 100; i++) {
        if (currentTickPosition) {
          lastTickPosition = currentTickPosition.clone();
        }
        currentTickPosition = entity.position.clone();
        
        detectedMovement = isEntityApproaching(bot, entity, lastTickPosition, currentTickPosition);
        // Should return null (stationary) because entity hasn't moved yet
        expect(detectedMovement).toBe(null);
      }

      // Now entity moves (game tick updates position)
      entityPositionRef.x = 8; // Entity moves towards bot

      // Next shouldTransition call
      if (currentTickPosition) {
        lastTickPosition = currentTickPosition.clone();
      }
      currentTickPosition = entity.position.clone();
      
      detectedMovement = isEntityApproaching(bot, entity, lastTickPosition, currentTickPosition);
      
      // Should NOW detect movement!
      expect(detectedMovement).toBe(true);
      expect(lastTickPosition!.x).toBe(10);  // Preserved old position
      expect(currentTickPosition!.x).toBe(8); // New position
    });
  });
});

