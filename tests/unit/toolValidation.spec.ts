import {
  getToolRemainingUses,
  getToolInfo,
  hasToolForBlock,
  getMinimumToolForBlock,
  findToolInInventory,
  getBlockToolRequirement,
  findBestToolForBlock,
  getToolTier,
  hasEqualOrBetterToolTier
} from '../../utils/toolValidation';

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
  });

  describe('getToolInfo', () => {
    it('should return null for null item', () => {
      const bot = createMockBot();
      expect(getToolInfo(bot, null)).toBeNull();
    });

    it('should return tool info with correct remaining uses', () => {
      const bot = createMockBot({
        items: {
          274: { maxDurability: 131 }
        }
      });
      const item = { type: 274, name: 'stone_pickaxe', durabilityUsed: 50 };
      const info = getToolInfo(bot, item);
      
      expect(info).not.toBeNull();
      expect(info?.name).toBe('stone_pickaxe');
      expect(info?.remainingUses).toBe(81);
      expect(info?.maxDurability).toBe(131);
    });
  });

  describe('hasToolForBlock', () => {
    it('should return true for blocks requiring no tools', () => {
      const bot = createMockBotWithInventory([], '1.20.1');
      expect(hasToolForBlock(bot, 'dirt')).toBe(true);
    });

    it('should return false when tool is required but not in inventory', () => {
      const bot = createMockBotWithInventory([], '1.20.1');
      expect(hasToolForBlock(bot, 'stone')).toBe(false);
    });

    it('should return true when required tool is in inventory', () => {
      const minecraftData = require('minecraft-data');
      const mcData = minecraftData('1.20.1');
      
      // Get the actual tool type that can mine stone
      const stoneBlock = mcData.blocksByName['stone'];
      const harvestToolIds = Object.keys(stoneBlock.harvestTools || {});
      
      // Create bot with a pickaxe (any pickaxe can mine stone)
      const bot = {
        version: '1.20.1',
        inventory: {
          items: () => [{ type: Number(harvestToolIds[0]), name: 'wooden_pickaxe', durabilityUsed: 0 }]
        },
        registry: {
          items: {
            [harvestToolIds[0]]: { maxDurability: 59 }
          }
        }
      };
      
      expect(hasToolForBlock(bot, 'stone')).toBe(true);
    });
  });

  describe('getMinimumToolForBlock', () => {
    it('should return null for blocks requiring no tools', () => {
      const bot = createMockBot({ version: '1.20.1' });
      expect(getMinimumToolForBlock(bot, 'dirt')).toBeNull();
    });

    it('should return wooden_pickaxe for stone', () => {
      const bot = createMockBot({ version: '1.20.1' });
      const tool = getMinimumToolForBlock(bot, 'stone');
      expect(tool).toContain('pickaxe');
      expect(tool).toContain('wooden');
    });
  });

  describe('findToolInInventory', () => {
    it('should return null when tool not in inventory', () => {
      const bot = createMockBotWithInventory([], '1.20.1');
      expect(findToolInInventory(bot, 'wooden_pickaxe')).toBeNull();
    });

    it('should find tool by name', () => {
      const items = [
        { type: 270, name: 'wooden_pickaxe', durabilityUsed: 0 },
        { type: 271, name: 'wooden_axe', durabilityUsed: 0 }
      ];
      const bot = createMockBotWithInventory(items, '1.20.1');
      const tool = findToolInInventory(bot, 'wooden_pickaxe');
      
      expect(tool).not.toBeNull();
      expect(tool?.name).toBe('wooden_pickaxe');
    });
  });

  describe('findBestToolForBlock', () => {
    it('should return null when no suitable tool in inventory', () => {
      const bot = createMockBotWithInventory([], '1.20.1');
      expect(findBestToolForBlock(bot, 'stone')).toBeNull();
    });

    it('should return the tool with highest tier', () => {
      const minecraftData = require('minecraft-data');
      const mcData = minecraftData('1.20.1');
      
      // Get actual pickaxe types from minecraft-data
      const woodenPickaxe = mcData.itemsByName['wooden_pickaxe'];
      const stonePickaxe = mcData.itemsByName['stone_pickaxe'];
      
      const items = [
        { type: woodenPickaxe.id, name: 'wooden_pickaxe', durabilityUsed: 0 },
        { type: stonePickaxe.id, name: 'stone_pickaxe', durabilityUsed: 0 }
      ];
      
      const bot = {
        version: '1.20.1',
        inventory: {
          items: () => items
        },
        registry: {
          items: {
            [woodenPickaxe.id]: { maxDurability: 59 },
            [stonePickaxe.id]: { maxDurability: 131 }
          }
        }
      };
      
      const tool = findBestToolForBlock(bot, 'stone');
      // Should return stone_pickaxe (higher tier) not wooden
      expect(tool?.name).toBe('stone_pickaxe');
    });
  });

  describe('getToolTier', () => {
    it('should return correct tier for wooden tools', () => {
      expect(getToolTier('wooden_pickaxe')).toBe(0);
    });

    it('should return correct tier for stone tools', () => {
      expect(getToolTier('stone_pickaxe')).toBe(1);
    });

    it('should return correct tier for iron tools', () => {
      expect(getToolTier('iron_pickaxe')).toBe(2);
    });

    it('should return correct tier for diamond tools', () => {
      expect(getToolTier('diamond_pickaxe')).toBe(4);
    });

    it('should return -1 for unknown tools', () => {
      expect(getToolTier('unknown_tool')).toBe(-1);
    });
  });

  describe('hasEqualOrBetterToolTier', () => {
    it('should return false when no tools in inventory', () => {
      const bot = createMockBotWithInventory([], '1.20.1');
      expect(hasEqualOrBetterToolTier(bot, 'wooden_pickaxe')).toBe(false);
    });

    it('should return true when exact tool tier is in inventory', () => {
      const items = [{ type: 270, name: 'wooden_pickaxe', durabilityUsed: 0 }];
      const bot = createMockBotWithInventory(items, '1.20.1');
      expect(hasEqualOrBetterToolTier(bot, 'wooden_pickaxe')).toBe(true);
    });

    it('should return true when better tool tier is in inventory', () => {
      const items = [{ type: 274, name: 'stone_pickaxe', durabilityUsed: 0 }];
      const bot = createMockBotWithInventory(items, '1.20.1');
      expect(hasEqualOrBetterToolTier(bot, 'wooden_pickaxe')).toBe(true);
    });

    it('should return false when lower tool tier is in inventory', () => {
      const items = [{ type: 270, name: 'wooden_pickaxe', durabilityUsed: 0 }];
      const bot = createMockBotWithInventory(items, '1.20.1');
      expect(hasEqualOrBetterToolTier(bot, 'stone_pickaxe')).toBe(false);
    });

    it('should check tool type matches (pickaxe vs axe)', () => {
      const items = [{ type: 271, name: 'wooden_axe', durabilityUsed: 0 }];
      const bot = createMockBotWithInventory(items, '1.20.1');
      expect(hasEqualOrBetterToolTier(bot, 'wooden_pickaxe')).toBe(false);
    });
  });

  describe('getBlockToolRequirement', () => {
    it('should return empty requirement for blocks needing no tools', () => {
      const bot = createMockBot({ version: '1.20.1' });
      const req = getBlockToolRequirement(bot, 'dirt');
      
      expect(req.blockName).toBe('dirt');
      expect(req.requiresToolType).toBeNull();
      expect(req.minimumToolTier).toBeNull();
      expect(req.harvestToolIds).toHaveLength(0);
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

function createMockBotWithInventory(items: any[], version: string = '1.20.1'): any {
  // Mock registry with proper maxDurability values for tools
  const registryItems: any = {};
  for (const item of items) {
    if (item.type === 270) registryItems[270] = { maxDurability: 59 };  // wooden_pickaxe
    if (item.type === 274) registryItems[274] = { maxDurability: 131 }; // stone_pickaxe
    if (item.type === 257) registryItems[257] = { maxDurability: 250 }; // iron_pickaxe
    if (item.type === 278) registryItems[278] = { maxDurability: 1561 }; // diamond_pickaxe
  }
  
  return {
    version,
    inventory: {
      items: () => items
    },
    registry: {
      items: registryItems
    }
  };
}

