/**
 * Unit tests for node builders
 */

import { 
  createMineLeafNode, 
  isMiningFeasible,
  createHuntLeafNode, 
  calculateExpectedKills,
  isHuntingFeasible,
  createSmeltNode,
  calculateFuelNeeded
} from '../../action_tree/builders';

describe('nodeBuilders', () => {
  describe('mineNodeBuilder', () => {
    test('creates mine leaf node', () => {
      const node = createMineLeafNode('coal_ore', 'coal', 5, 'wooden_pickaxe');
      expect(node.action).toBe('mine');
      expect(node.what).toBe('coal_ore');
      expect(node.targetItem).toBe('coal');
      expect(node.count).toBe(5);
      expect(node.tool).toBe('wooden_pickaxe');
    });

    test('creates mine leaf node without tool', () => {
      const node = createMineLeafNode('cobweb', 'string', 3);
      expect(node.action).toBe('mine');
      expect(node.what).toBe('cobweb');
      expect(node.targetItem).toBe('string');
      expect(node.count).toBe(3);
      expect(node.tool).toBeUndefined();
    });

    test('checks mining feasibility', () => {
      expect(isMiningFeasible(null, 'coal_ore', 5)).toBe(true);
      expect(isMiningFeasible(undefined, 'coal_ore', 5)).toBe(true);
    });
  });

  describe('huntNodeBuilder', () => {
    test('creates hunt leaf node', () => {
      const node = createHuntLeafNode('chicken', 'feather', 8, 0.125);
      expect(node.action).toBe('hunt');
      expect(node.what).toBe('chicken');
      expect(node.targetItem).toBe('feather');
      expect(node.count).toBe(8);
      expect(node.dropChance).toBe(0.125);
    });

    test('calculates expected kills', () => {
      expect(calculateExpectedKills(1, 0.125)).toBe(8);
      expect(calculateExpectedKills(5, 0.5)).toBe(10);
      expect(calculateExpectedKills(3)).toBe(3); // default drop chance of 1
    });

    test('checks hunting feasibility', () => {
      expect(isHuntingFeasible(null, 'chicken', 8)).toBe(true);
      expect(isHuntingFeasible(undefined, 'spider', 5)).toBe(true);
    });
  });

  describe('smeltNodeBuilder', () => {
    test('creates smelt node', () => {
      const node = createSmeltNode('iron_ingot', 'raw_iron', 3, 'coal');
      expect(node.action).toBe('smelt');
      expect(node.what).toBe('furnace');
      expect(node.count).toBe(3);
      expect(node.result.item).toBe('iron_ingot');
      expect(node.input.item).toBe('raw_iron');
      expect(node.fuel).toBe('coal');
    });

    test('creates smelt node without fuel', () => {
      const node = createSmeltNode('glass', 'sand', 2);
      expect(node.action).toBe('smelt');
      expect(node.what).toBe('furnace');
      expect(node.count).toBe(2);
      expect(node.result.item).toBe('glass');
      expect(node.input.item).toBe('sand');
      expect(node.fuel).toBeNull();
    });

    test('calculates fuel needed', () => {
      const invMap = new Map([['coal', 2]]);
      expect(calculateFuelNeeded(8, 'coal', invMap)).toBe(0); // 8 smelts need 1 coal, have 2
      expect(calculateFuelNeeded(16, 'coal', invMap)).toBe(0); // 16 smelts need 2 coal, have 2
      expect(calculateFuelNeeded(24, 'coal', invMap)).toBe(1); // 24 smelts need 3 coal, have 2
    });
  });
});
