/**
 * Integration test for the full rotation and attack flow
 * Tests the interaction between behaviorRotate, behaviorLookAt, and behaviorAttackEntity
 */

import createAttackEntityState from '../../behaviors/behaviorAttackEntity';
import { createRotationBot, createMockEntity } from '../utils/rotationHelpers';
import { runWithFakeClock, withLoggerSpy } from '../utils/stateMachineRunner';

describe('integration: rotation attack flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('complete attack sequence with weapon equip', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: Math.PI, pitch: 0 });
    
    const sword = { name: 'diamond_sword', type: 276 };
    bot.inventory = {
      slots: [sword],
      items: () => [sword]
    };
    bot.heldItem = null;
    bot.equip = jest.fn().mockImplementation((item: any) => {
      bot.heldItem = item;
      return Promise.resolve();
    });

    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 3, y: 64, z: 0 },
      width: 0.6,
      height: 1.8
    });

    bot.entities = { 1: entity };
    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, sm, { maxMs: 5000, stepMs: 50, directNested: true });
    });

    expect(bot.equip).toHaveBeenCalled();
    expect(bot.lookCalls.length).toBeGreaterThan(0);
    expect(bot.attackCalls.length).toBe(1);
    expect(sm.isFinished()).toBe(true);
  });

  test('attacks multiple entities in sequence', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    
    const entities = [
      createMockEntity({ id: 1, name: 'zombie', position: { x: 2, y: 64, z: 0 } }),
      createMockEntity({ id: 2, name: 'skeleton', position: { x: -2, y: 64, z: 0 } })
    ];

    bot.entities = { 1: entities[0], 2: entities[1] };

    for (const entity of entities) {
      const targets: any = { entity };
      const sm = createAttackEntityState(bot, targets);

      await withLoggerSpy(async () => {
        await runWithFakeClock(bot as any, sm, { maxMs: 5000, stepMs: 50, directNested: true });
      });

      expect(sm.isFinished()).toBe(true);
    }

    expect(bot.attackCalls.length).toBe(2);
  });

  test('smooth rotation from various starting angles', async () => {
    const startingAngles = [
      { yaw: 0, pitch: 0 },
      { yaw: Math.PI / 2, pitch: 0 },
      { yaw: Math.PI, pitch: 0 }
    ];

    for (const startAngle of startingAngles) {
      const bot = createRotationBot({
        position: { x: 0, y: 64, z: 0 },
        yaw: startAngle.yaw,
        pitch: startAngle.pitch
      });

      const entity = createMockEntity({
        id: 1,
        name: 'zombie',
        position: { x: 3, y: 64, z: 0 }
      });

      bot.entities = { 1: entity };
      const targets: any = { entity };
      const sm = createAttackEntityState(bot, targets);

      await withLoggerSpy(async () => {
        await runWithFakeClock(bot as any, sm, { maxMs: 5000, stepMs: 50, directNested: true });
      });

      expect(sm.isFinished()).toBe(true);
      expect(bot.attackCalls.length).toBeGreaterThan(0);
      bot.attackCalls.length = 0;
    }
  });

  test('handles entity movement during attack sequence', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 2, y: 64, z: 0 }
    });

    bot.entities = { 1: entity };
    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    setTimeout(() => {
      entity.position.x = 2.5;
      entity.position.z = 0.5;
    }, 500);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, sm, { maxMs: 5000, stepMs: 50, directNested: true });
    });

    expect(sm.isFinished()).toBe(true);
    expect(bot.attackCalls.length).toBe(1);
  });

  test('rotation produces multiple smooth look updates', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 10, y: 64, z: 10 }
    });

    bot.entities = { 1: entity };
    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, sm, { maxMs: 5000, stepMs: 50, directNested: true });
    });

    expect(bot.lookCalls.length).toBeGreaterThan(5);
    expect(sm.isFinished()).toBe(true);
  });

  test('looks at nearest point on tall entity bounding box', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    
    const entity = createMockEntity({
      id: 1,
      name: 'enderman',
      position: { x: 2, y: 64, z: 0 },
      width: 0.6,
      height: 2.9
    });

    bot.entities = { 1: entity };
    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, sm, { maxMs: 5000, stepMs: 50, directNested: true });
    });

    expect(Math.abs(bot.entity.pitch)).toBeLessThan(0.5);
    expect(bot.attackCalls.length).toBe(1);
    expect(sm.isFinished()).toBe(true);
  });

  test('attack sequence completes within reasonable time', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: Math.PI, pitch: 0.5 });
    
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 3, y: 65, z: 0 }
    });

    bot.entities = { 1: entity };
    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    const startTime = Date.now();

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, sm, { maxMs: 5000, stepMs: 50, directNested: true });
    });

    const duration = Date.now() - startTime;

    expect(sm.isFinished()).toBe(true);
    expect(bot.attackCalls.length).toBe(1);
    expect(duration).toBeLessThan(6000);
  });

  test('handles no weapon available gracefully', async () => {
    const bot = createRotationBot({ position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 });
    bot.inventory = { slots: [], items: () => [] };
    
    const entity = createMockEntity({
      id: 1,
      name: 'zombie',
      position: { x: 2, y: 64, z: 0 }
    });

    bot.entities = { 1: entity };
    const targets: any = { entity };
    const sm = createAttackEntityState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, sm, { maxMs: 5000, stepMs: 50, directNested: true });
    });

    expect(sm.isFinished()).toBe(true);
    expect(bot.attackCalls.length).toBe(1);
  });
});
