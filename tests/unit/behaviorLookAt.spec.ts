import createLookAtState from '../../behaviors/behaviorLookAt';
import { createRotationBot, createMockEntity, anglesDifferenceInDegrees } from '../utils/rotationHelpers';
import { runWithFakeClock, withLoggerSpy } from '../utils/stateMachineRunner';

describe('unit: behaviorLookAt', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('calculates correct yaw and pitch for position', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const lookPosition = { x: 10, y: 64, z: 0 }; // Directly east
    const targets: any = { position: lookPosition };

    const sm = createLookAtState(bot, targets, 3.0);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 2000, stepMs: 50, directNested: true });
    });

    // Looking east should result in yaw ≈ -π/2 (or 3π/2 normalized)
    const expectedYaw = Math.atan2(-10, 0); // ≈ -π/2
    const yawDiff = anglesDifferenceInDegrees(bot.entity.yaw, expectedYaw);
    
    expect(yawDiff).toBeLessThan(2);
    expect(sm.isFinished()).toBe(true);
  });

  test('looks at entity bounding box when entity is provided', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      name: 'zombie',
      position: { x: 5, y: 64, z: 0 },
      width: 0.6,
      height: 1.8
    });

    const targets: any = {};
    const sm = createLookAtState(bot, targets, 3.0, entity);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 2000, stepMs: 50, directNested: true });
    });

    // Should have completed rotation
    expect(sm.isFinished()).toBe(true);
    expect(bot.lookCalls.length).toBeGreaterThan(0);
  });

  test('uses nearest point on bounding box, not center', async () => {
    // Bot positioned below the entity
    const bot = createRotationBot({ position: { x: 10, y: 60, z: 0 }, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      name: 'zombie',
      position: { x: 10, y: 64, z: 0 }, // Directly above
      width: 0.6,
      height: 1.8
    });

    const targets: any = {};
    const sm = createLookAtState(bot, targets, 3.0, entity);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 2000, stepMs: 50, directNested: true });
    });

    // Since bot is directly below, should look at bottom of bounding box (entity.position.y)
    // Results in positive pitch value
    expect(bot.entity.pitch).toBeGreaterThan(0);
    expect(sm.isFinished()).toBe(true);
  });

  test('handles entity very close to bot', async () => {
    const position = { x: 0, y: 64, z: 0 };
    const bot = createRotationBot({ position, yaw: 0, pitch: 0 });
    const entity = createMockEntity({
      name: 'zombie',
      position: { x: 1, y: 64, z: 0 }, // Close but not too close
      width: 0.6,
      height: 1.8
    });

    const targets: any = {};
    const sm = createLookAtState(bot, targets, 5.0, entity);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 2000, stepMs: 50, directNested: true });
    });

    // Should complete without errors even when very close
    expect(sm.isFinished()).toBe(true);
  });

  test('can update entity reference after creation', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const entity1 = createMockEntity({
      name: 'zombie',
      position: { x: 10, y: 64, z: 0 }
    });
    const entity2 = createMockEntity({
      name: 'skeleton',
      position: { x: -10, y: 64, z: 0 }
    });

    const targets: any = {};
    const sm = createLookAtState(bot, targets, 3.0, entity1);

    // Update entity before running
    (sm as any).entity = entity2;

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 2000, stepMs: 50, directNested: true });
    });

    // Should look towards entity2 (west, negative X), not entity1 (east)
    // Yaw for looking west should be ≈ π/2
    const expectedYaw = Math.atan2(10, 0); // Looking at x=-10 from x=0
    const yawDiff = anglesDifferenceInDegrees(bot.entity.yaw, expectedYaw);
    
    expect(yawDiff).toBeLessThan(5);
    expect(sm.isFinished()).toBe(true);
  });

  test('falls back to position target when no entity', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const lookPosition = { x: 10, y: 64, z: 0 }; // East (positive X)
    const targets: any = { position: lookPosition };

    const sm = createLookAtState(bot, targets, 3.0, null);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 2000, stepMs: 50, directNested: true });
    });

    // Should complete successfully by using position target
    expect(sm.isFinished()).toBe(true);
    expect(bot.lookCalls.length).toBeGreaterThan(0);
  });

  test('handles missing position and entity gracefully', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 1.5, pitch: 0.5 });
    const targets: any = {}; // No position or entity

    const sm = createLookAtState(bot, targets, 3.0, null);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 1000, stepMs: 50, directNested: true });
    });

    // Should complete gracefully without crashing
    // Angles should remain unchanged
    expect(bot.entity.yaw).toBeCloseTo(1.5, 1);
    expect(bot.entity.pitch).toBeCloseTo(0.5, 1);
    expect(sm.isFinished()).toBe(true);
  });

  test('rotation speed parameter affects completion time', async () => {
    const bot1 = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const bot2 = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    
    const lookPosition = { x: 10, y: 64, z: 10 };
    const targets1: any = { position: lookPosition };
    const targets2: any = { position: lookPosition };

    const slowSm = createLookAtState(bot1, targets1, 1.0); // Slow
    const fastSm = createLookAtState(bot2, targets2, 10.0); // Fast

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot1, slowSm, { maxMs: 500, stepMs: 50, directNested: true });
      await runWithFakeClock(bot2, fastSm, { maxMs: 500, stepMs: 50, directNested: true });
    });

    // Fast rotation should be complete, slow might not be
    expect(fastSm.isFinished()).toBe(true);
  });

  test('calculates correct pitch for looking up', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const lookPosition = { x: 0, y: 74, z: 0 }; // 10 blocks above
    const targets: any = { position: lookPosition };

    const sm = createLookAtState(bot, targets, 3.0);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 2000, stepMs: 50, directNested: true });
    });

    // Target is above, results in positive pitch value
    expect(bot.entity.pitch).toBeGreaterThan(0);
    expect(sm.isFinished()).toBe(true);
  });

  test('calculates correct pitch for looking down', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    const lookPosition = { x: 0, y: 54, z: 0 }; // 10 blocks below
    const targets: any = { position: lookPosition };

    const sm = createLookAtState(bot, targets, 3.0);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 2000, stepMs: 50, directNested: true });
    });

    // Target is below, results in negative pitch value
    expect(bot.entity.pitch).toBeLessThan(0);
    expect(sm.isFinished()).toBe(true);
  });
});

