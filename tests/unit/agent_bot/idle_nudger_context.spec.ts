import { buildNudgeContext } from '../../../bots/agent_bot/idle_nudger_context';

function makeBot(overrides: Partial<any> = {}) {
  return {
    entity: { position: { x: -1234.4, y: 67.0, z: 89.6 } },
    game: { dimension: 'overworld' },
    health: 18,
    food: 14,
    foodSaturation: 2.5,
    time: { timeOfDay: 13000 },
    inventory: {
      items: () => [
        { name: 'cobblestone', count: 64 },
        { name: 'cobblestone', count: 64 },
        { name: 'oak_log', count: 13 },
        { name: 'iron_pickaxe', count: 1 }
      ]
    },
    ...overrides
  };
}

describe('buildNudgeContext', () => {
  it('contains the nudge number and idle seconds', () => {
    const out = buildNudgeContext({ bot: makeBot(), idleMs: 75_000, nudgeNumber: 2 });
    expect(out).toMatch(/idle-nudge #2 \| idle for 75s/);
  });

  it('reports rounded position and dimension', () => {
    const out = buildNudgeContext({ bot: makeBot(), idleMs: 60_000, nudgeNumber: 0 });
    expect(out).toMatch(/position: \(-1234, 67, 90\) in overworld/);
  });

  it('reports health, food, saturation', () => {
    const out = buildNudgeContext({ bot: makeBot(), idleMs: 60_000, nudgeNumber: 0 });
    expect(out).toMatch(/health: 18\/20/);
    expect(out).toMatch(/food: 14\/20/);
    expect(out).toMatch(/saturation: 2\.5/);
  });

  it('classifies time of day', () => {
    const day = buildNudgeContext({ bot: makeBot({ time: { timeOfDay: 6000 } }), idleMs: 60_000, nudgeNumber: 0 });
    const night = buildNudgeContext({ bot: makeBot({ time: { timeOfDay: 18000 } }), idleMs: 60_000, nudgeNumber: 0 });
    expect(day).toMatch(/time: day/);
    expect(night).toMatch(/time: night/);
  });

  it('aggregates inventory by name and sorts by count desc', () => {
    const out = buildNudgeContext({ bot: makeBot(), idleMs: 60_000, nudgeNumber: 0 });
    expect(out).toMatch(/inventory \(top 30 by count\): cobblestone:128, oak_log:13, iron_pickaxe:1/);
  });

  it('truncates inventory to top 30 entries', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ name: `item_${i}`, count: 50 - i }));
    const out = buildNudgeContext({ bot: makeBot({ inventory: { items: () => items } }), idleMs: 60_000, nudgeNumber: 0 });
    expect(out).toMatch(/item_0:50/);
    expect(out).toMatch(/item_29:21/);
    expect(out).not.toMatch(/item_30:/);
  });

  it('handles empty inventory', () => {
    const out = buildNudgeContext({ bot: makeBot({ inventory: { items: () => [] } }), idleMs: 60_000, nudgeNumber: 0 });
    expect(out).toMatch(/inventory \(top 30 by count\): \(empty\)/);
  });

  it('includes the call-to-action footer', () => {
    const out = buildNudgeContext({ bot: makeBot(), idleMs: 60_000, nudgeNumber: 0 });
    expect(out).toMatch(/Pick up where you left off by calling a tool/);
    expect(out).toMatch(/finish_session/);
  });
});
