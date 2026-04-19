import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { createToolReplacementBehavior } from '../../bots/collector/reactive_behaviors/tool_replacement_behavior';

describe('tool_replacement_behavior registry integration', () => {
  it('is selected when a tool is below threshold', async () => {
    const executor: any = { executeReplacement: jest.fn(async () => true) };
    const toolsBeingReplaced = new Set<string>();
    const registry = new ReactiveBehaviorRegistry();
    registry.register(createToolReplacementBehavior({
      executor,
      toolsBeingReplaced,
      durabilityThreshold: 0.1
    }));

    const bot: any = {
      inventory: {
        items: () => [{ name: 'iron_pickaxe', type: 256, count: 1, durabilityUsed: 237, maxDurability: 250 }]
      },
      registry: { items: { 256: { maxDurability: 250 } } }
    };
    const active = await registry.findActiveBehavior(bot);
    expect(active).not.toBeNull();
    expect(active!.name).toBe('tool_replacement');
  });

  it('is not selected when the tool has a healthy spare', async () => {
    const executor: any = { executeReplacement: jest.fn() };
    const registry = new ReactiveBehaviorRegistry();
    registry.register(createToolReplacementBehavior({
      executor,
      toolsBeingReplaced: new Set<string>(),
      durabilityThreshold: 0.1
    }));

    const bot: any = {
      inventory: {
        items: () => [
          { name: 'iron_pickaxe', type: 256, count: 1, durabilityUsed: 237, maxDurability: 250 },
          { name: 'iron_pickaxe', type: 256, count: 1, durabilityUsed: 50,  maxDurability: 250 }
        ]
      },
      registry: { items: { 256: { maxDurability: 250 } } }
    };
    const active = await registry.findActiveBehavior(bot);
    expect(active).toBeNull();
  });
});
