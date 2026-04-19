import { createToolReplacementBehavior } from '../../bots/collector/reactive_behaviors/tool_replacement_behavior';

function makeBot(items: any[] = []) {
  const registryItems: Record<number, any> = {};
  for (const it of items) {
    if (it && it.maxDurability) {
      registryItems[it.type] = { maxDurability: it.maxDurability };
    }
  }
  return {
    inventory: { items: () => items },
    registry: { items: registryItems },
    version: '1.21.11'
  } as any;
}

function makeExecutor() {
  return {
    executeReplacement: jest.fn(async () => true)
  } as any;
}

describe('tool_replacement_behavior', () => {
  describe('shouldActivate', () => {
    it('returns false when inventory is empty', async () => {
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const result = await behavior.shouldActivate(makeBot([]));
      expect(result).toBe(false);
    });
  });
});
