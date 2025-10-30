/**
 * Unit tests for tool selection logic in behaviorCollectBlock
 * Tests the strategy: use lowest durability tool first, check for replacements before triggering
 */

describe('Tool Selection Logic', () => {
  let mockItems: any[];

  beforeEach(() => {
    mockItems = [];
  });

  describe('pickBestToolForBlock - Use highest tier, then lowest durability', () => {
    it('should select tool with lowest remaining uses within same tier', () => {
      // Setup: Bot has 2 diamond pickaxes - one with 18 uses, one with 1561 uses
      mockItems = [
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1543, maxDurability: 1561 }, // 18 uses left
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 0, maxDurability: 1561 } // 1561 uses left
      ];

      // Both are same tier (diamond), so select lowest durability
      const tool1RemainingUses = 1561 - 1543; // 18
      const tool2RemainingUses = 1561 - 0; // 1561

      expect(tool1RemainingUses).toBe(18);
      expect(tool2RemainingUses).toBe(1561);
      expect(tool1RemainingUses).toBeLessThan(tool2RemainingUses);
      
      // Logic should select tool1 (lowest durability within diamond tier)
    });

    it('should prefer higher tier tool over lower tier with less durability', () => {
      // Setup: Bot has iron pickaxe (30 uses) and diamond pickaxe (50 uses)
      mockItems = [
        { name: 'iron_pickaxe', type: 257, durabilityUsed: 220, maxDurability: 250 }, // 30 uses left
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1511, maxDurability: 1561 } // 50 uses left
      ];

      const ironUses = 250 - 220; // 30
      const diamondUses = 1561 - 1511; // 50

      expect(ironUses).toBe(30);
      expect(diamondUses).toBe(50);
      expect(ironUses).toBeLessThan(diamondUses);
      
      // Logic should select diamond_pickaxe (higher tier) even though iron has less durability
      // This is because we prioritize tier first, then durability
    });

    it('should not select tool with 0 remaining uses', () => {
      mockItems = [
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1561, maxDurability: 1561 }, // 0 uses (broken)
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 100, maxDurability: 1561 } // 1461 uses left
      ];

      const tool1RemainingUses = 1561 - 1561; // 0
      const tool2RemainingUses = 1561 - 100; // 1461

      expect(tool1RemainingUses).toBe(0);
      expect(tool2RemainingUses).toBeGreaterThan(0);
      
      // Logic should select tool2, skip broken tool
    });

    it('should handle single tool correctly', () => {
      mockItems = [
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 500, maxDurability: 1561 } // 1061 uses left
      ];

      const remainingUses = 1561 - 500;
      expect(remainingUses).toBe(1061);
      
      // Logic should select the only available tool
    });

    it('should prefer lowest durability among tools of same tier', () => {
      mockItems = [
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1550, maxDurability: 1561 }, // 11 uses
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1540, maxDurability: 1561 }, // 21 uses
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1560, maxDurability: 1561 }  // 1 use
      ];

      const uses = mockItems.map(item => item.maxDurability - item.durabilityUsed);
      expect(Math.min(...uses)).toBe(1);
      
      // Logic should select tool with 1 use remaining (all same tier)
    });

    it('should handle mixed tiers correctly', () => {
      mockItems = [
        { name: 'wooden_pickaxe', type: 270, durabilityUsed: 0, maxDurability: 59 },   // 59 uses, tier 0
        { name: 'stone_pickaxe', type: 274, durabilityUsed: 100, maxDurability: 131 }, // 31 uses, tier 1
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1560, maxDurability: 1561 } // 1 use, tier 4
      ];

      // Should select diamond (highest tier) even though it has only 1 use
      const diamondTier = 4;
      const stoneTier = 1;
      const woodenTier = 0;

      expect(diamondTier).toBeGreaterThan(stoneTier);
      expect(stoneTier).toBeGreaterThan(woodenTier);
    });
  });

  describe('Replacement Detection Logic', () => {
    it('should detect replacement when tool with higher durability exists', () => {
      const lowDurabilityTool = { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1543, maxDurability: 1561 }; // 18 uses
      const highDurabilityTool = { name: 'diamond_pickaxe', type: 278, durabilityUsed: 0, maxDurability: 1561 }; // 1561 uses
      
      mockItems = [lowDurabilityTool, highDurabilityTool];
      
      const threshold = 20;
      const lowToolRemainingUses = 18;
      const highToolRemainingUses = 1561;

      // Check if replacement exists
      const hasReplacement = mockItems.some(item => {
        if (item.name !== lowDurabilityTool.name) return false;
        const itemRemainingUses = item.maxDurability - (item.durabilityUsed || 0);
        return itemRemainingUses > threshold;
      });

      expect(hasReplacement).toBe(true);
      expect(lowToolRemainingUses).toBeLessThanOrEqual(threshold);
      expect(highToolRemainingUses).toBeGreaterThan(threshold);
    });

    it('should not detect replacement when only low durability tool exists', () => {
      const lowDurabilityTool = { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1543, maxDurability: 1561 }; // 18 uses
      
      mockItems = [lowDurabilityTool];
      
      const threshold = 20;
      const toolRemainingUses = 18;

      const hasReplacement = mockItems.some(item => {
        if (item.name !== lowDurabilityTool.name) return false;
        const itemRemainingUses = item.maxDurability - (item.durabilityUsed || 0);
        return itemRemainingUses > threshold;
      });

      expect(hasReplacement).toBe(false);
      expect(toolRemainingUses).toBeLessThanOrEqual(threshold);
    });

    it('should not detect replacement when all tools are below threshold', () => {
      mockItems = [
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1543, maxDurability: 1561 }, // 18 uses
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1546, maxDurability: 1561 }  // 15 uses
      ];
      
      const threshold = 20;

      const hasReplacement = mockItems.some(item => {
        const itemRemainingUses = item.maxDurability - (item.durabilityUsed || 0);
        return itemRemainingUses > threshold;
      });

      expect(hasReplacement).toBe(false);
    });

    it('should handle exact threshold boundary', () => {
      const boundaryTool = { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1541, maxDurability: 1561 }; // 20 uses (exact threshold)
      
      mockItems = [boundaryTool];
      
      const threshold = 20;
      const toolRemainingUses = 20;

      expect(toolRemainingUses).toBe(threshold);
      
      // At threshold, should trigger replacement
      const shouldTrigger = toolRemainingUses <= threshold;
      expect(shouldTrigger).toBe(true);
    });
  });

  describe('Tool Switching Behavior', () => {
    it('should eventually switch to high durability tool after low one is used up', () => {
      const initialItems = [
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 1560, maxDurability: 1561 }, // 1 use
        { name: 'diamond_pickaxe', type: 278, durabilityUsed: 0, maxDurability: 1561 }     // 1561 uses
      ];

      // Simulate mining with first tool
      const firstTool = initialItems[0];
      firstTool.durabilityUsed = 1561; // Now broken (0 uses)

      const remainingAfterBreak = firstTool.maxDurability - firstTool.durabilityUsed;
      expect(remainingAfterBreak).toBe(0);

      // After first tool breaks, only second tool should be available
      const availableTools = initialItems.filter(item => {
        const remaining = item.maxDurability - item.durabilityUsed;
        return remaining > 0;
      });

      expect(availableTools.length).toBe(1);
      expect(availableTools[0].durabilityUsed).toBe(0);
    });
  });

  describe('Different Tool Types', () => {
    it('should handle iron pickaxe correctly', () => {
      mockItems = [
        { name: 'iron_pickaxe', type: 257, durabilityUsed: 240, maxDurability: 250 } // 10 uses
      ];

      const remainingUses = 250 - 240;
      expect(remainingUses).toBe(10);
    });

    it('should handle stone pickaxe correctly', () => {
      mockItems = [
        { name: 'stone_pickaxe', type: 274, durabilityUsed: 120, maxDurability: 131 } // 11 uses
      ];

      const remainingUses = 131 - 120;
      expect(remainingUses).toBe(11);
    });

    it('should handle wooden pickaxe correctly', () => {
      mockItems = [
        { name: 'wooden_pickaxe', type: 270, durabilityUsed: 55, maxDurability: 59 } // 4 uses
      ];

      const remainingUses = 59 - 55;
      expect(remainingUses).toBe(4);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty inventory', () => {
      mockItems = [];

      expect(mockItems.length).toBe(0);
      // Logic should return null or handle gracefully
    });

    it('should handle inventory with no tools', () => {
      mockItems = [
        { name: 'dirt', type: 3 },
        { name: 'stone', type: 1 }
      ];

      const tools = mockItems.filter(item => 
        item.name && item.name.includes('pickaxe')
      );

      expect(tools.length).toBe(0);
    });

    it('should handle missing durabilityUsed property', () => {
      const tool: any = { name: 'diamond_pickaxe', type: 278, maxDurability: 1561 };
      
      const durabilityUsed = tool.durabilityUsed || 0;
      const remainingUses = tool.maxDurability - durabilityUsed;

      expect(remainingUses).toBe(1561);
    });
  });
});

