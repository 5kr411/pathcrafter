import { BehaviorCaptureOrigin } from '../../behaviors/behaviorCaptureOrigin';

describe('BehaviorCaptureOrigin', () => {
  it('writes bot position into targets.originPosition on entry', () => {
    const bot: any = { entity: { position: { x: 10, y: 64, z: -3 } } };
    const targets: any = {};
    const s = new BehaviorCaptureOrigin(bot, targets);
    s.onStateEntered();
    expect(targets.originPosition).toEqual({ x: 10, y: 64, z: -3 });
    expect(s.isFinished()).toBe(true);
  });

  it('is finished immediately', () => {
    const bot: any = { entity: { position: { x: 0, y: 64, z: 0 } } };
    const s = new BehaviorCaptureOrigin(bot, {});
    s.onStateEntered();
    expect(s.isFinished()).toBe(true);
  });

  it('does not throw when bot.entity is missing; targets.originPosition stays undefined', () => {
    const bot: any = {};
    const targets: any = {};
    const s = new BehaviorCaptureOrigin(bot, targets);
    expect(() => s.onStateEntered()).not.toThrow();
    expect(targets.originPosition).toBeUndefined();
    expect(s.isFinished()).toBe(true);
  });
});
