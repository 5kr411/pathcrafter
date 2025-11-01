import createAttackEntityState from '../../behaviors/behaviorAttackEntity';
import { createRotationBot, createMockEntity } from '../utils/rotationHelpers';
import { runWithFakeClock, withLoggerSpy } from '../utils/stateMachineRunner';

describe('unit: behaviorAttackEntity', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('full flow: look at entity then attack', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 2, y: 64, z: 0 },
      width: 0.6,
      height: 1.8
    });

    // Add entity to bot.entities so validation passes
    bot.entities = { 1: entity };

    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Should have looked at entity
    expect(bot.lookCalls.length).toBeGreaterThan(0);
    
    // Should have attacked
    expect(bot.attackCalls.length).toBe(1);
    expect(bot.attackCalls[0]).toBe(entity);
    
    expect(sm.isFinished()).toBe(true);
  });

  test('skips weapon equip when no weapon available', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 2, y: 64, z: 0 }
    });

    bot.entities = { 1: entity };
    bot.inventory = { slots: [], items: () => [] }; // No items

    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Should still attack even without weapon
    expect(bot.attackCalls.length).toBe(1);
    expect(sm.isFinished()).toBe(true);
  });

  test('fails when entity too far away', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 20, y: 64, z: 0 } // More than 3.5 blocks away
    });

    bot.entities = { 1: entity };

    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Should not attack if too far
    expect(bot.attackCalls.length).toBe(0);
    expect(sm.isFinished()).toBe(true);
  });

  test('fails when entity no longer valid', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 2, y: 64, z: 0 }
    });

    // Entity not in bot.entities (despawned/killed)
    bot.entities = {};

    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Should not attack invalid entity
    expect(bot.attackCalls.length).toBe(0);
    expect(sm.isFinished()).toBe(true);
  });

  test('fails gracefully when no entity target', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const targets: any = { entity: null };

    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Should complete without crashing
    expect(bot.attackCalls.length).toBe(0);
    expect(sm.isFinished()).toBe(true);
  });

  test('handles attack promise rejection', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 2, y: 64, z: 0 }
    });

    bot.entities = { 1: entity };
    
    // Make attack fail
    bot.attack = jest.fn().mockRejectedValue(new Error('Attack failed'));

    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Should handle error gracefully
    expect(bot.attack).toHaveBeenCalled();
    expect(sm.isFinished()).toBe(true);
  });

  test('handles synchronous attack (returns undefined)', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 2, y: 64, z: 0 }
    });

    bot.entities = { 1: entity };
    
    // Make attack synchronous (returns undefined)
    bot.attack = jest.fn().mockReturnValue(undefined);

    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Should handle sync attack
    expect(bot.attack).toHaveBeenCalled();
    expect(sm.isFinished()).toBe(true);
  });

  test('attack within range succeeds', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 3, y: 64, z: 0 } // Exactly 3 blocks away (within 3.5 range)
    });

    bot.entities = { 1: entity };

    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Should attack successfully
    expect(bot.attackCalls.length).toBe(1);
    expect(sm.isFinished()).toBe(true);
  });

  test('completes attack sequence successfully', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 2, y: 64, z: 0 }
    });

    bot.entities = { 1: entity };

    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Should complete full sequence: look + attack
    expect(bot.attackCalls.length).toBe(1);
    expect(bot.lookCalls.length).toBeGreaterThan(0);
    expect(sm.isFinished()).toBe(true);
  });

  test('rotates to face entity before attacking', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 3, y: 64, z: 0 } // To the east
    });

    bot.entities = { 1: entity };

    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    // Bot should have rotated
    expect(bot.lookCalls.length).toBeGreaterThan(0);
    
    // Final yaw should be facing entity (eastward)
    const expectedYaw = Math.atan2(-3, 0); // ~-π/2
    const yawDiff = Math.abs(bot.entity.yaw - expectedYaw);
    expect(yawDiff).toBeLessThan(0.3); // Within ~17 degrees
    
    // Attack should happen after rotation
    expect(bot.attackCalls.length).toBe(1);
  });
});

