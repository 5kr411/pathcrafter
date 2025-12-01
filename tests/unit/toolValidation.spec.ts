import { getToolRemainingUses } from '../../utils/toolValidation';

describe('toolValidation', () => {
  describe('getToolRemainingUses', () => {
    it('should return 0 for null item', () => {
      const bot = createMockBot();
      expect(getToolRemainingUses(bot, null)).toBe(0);
    });

    it('should return 0 for non-tool item', () => {
      const bot = createMockBot();
      const item = { type: 1, name: 'dirt', durabilityUsed: 0 };
      expect(getToolRemainingUses(bot, item)).toBe(0);
    });

    it('should calculate remaining uses correctly', () => {
      const bot = createMockBot({
        items: {
          270: { maxDurability: 59 }
        }
      });
      const item = { type: 270, name: 'wooden_pickaxe', durabilityUsed: 10 };
      expect(getToolRemainingUses(bot, item)).toBe(49);
    });

    it('should return 0 for tool with no durability left', () => {
      const bot = createMockBot({
        items: {
          270: { maxDurability: 59 }
        }
      });
      const item = { type: 270, name: 'wooden_pickaxe', durabilityUsed: 59 };
      expect(getToolRemainingUses(bot, item)).toBe(0);
    });

    it('should return 0 for item without type', () => {
      const bot = createMockBot();
      const item = { name: 'wooden_pickaxe', durabilityUsed: 0 };
      expect(getToolRemainingUses(bot, item)).toBe(0);
    });

    it('should handle missing durabilityUsed (defaults to 0)', () => {
      const bot = createMockBot({
        items: {
          270: { maxDurability: 59 }
        }
      });
      const item = { type: 270, name: 'wooden_pickaxe' };
      expect(getToolRemainingUses(bot, item)).toBe(59);
    });
  });
});

function createMockBot(options: any = {}): any {
  return {
    version: options.version || '1.20.1',
    registry: {
      items: options.items || {}
    },
    inventory: {
      items: () => options.inventoryItems || []
    }
  };
}
