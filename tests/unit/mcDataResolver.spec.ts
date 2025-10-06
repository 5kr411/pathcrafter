/**
 * Unit tests for Minecraft data resolver utilities
 */

import { resolveMcData, ensureMinecraftDataFeaturesFiles } from '../../action_tree/utils/mcDataResolver';

describe('mcDataResolver', () => {
  describe('resolveMcData', () => {
    test('returns undefined for null/undefined input', () => {
      expect(resolveMcData(null)).toBeUndefined();
      expect(resolveMcData(undefined)).toBeUndefined();
    });

    test('resolves from version string', () => {
      const result = resolveMcData('1.19.2');
      expect(result).toBeDefined();
      expect(result?.itemsByName).toBeDefined();
      expect(result?.items).toBeDefined();
      expect(result?.blocks).toBeDefined();
      expect(result?.recipes).toBeDefined();
    });

    test('returns existing MinecraftData object as-is', () => {
      const mockMcData = {
        itemsByName: { 'oak_log': { id: 1, name: 'oak_log' } },
        items: { 1: { id: 1, name: 'oak_log' } },
        blocks: { 1: { id: 1, name: 'oak_log' } },
        recipes: { 1: [] }
      };
      
      const result = resolveMcData(mockMcData);
      expect(result).toBe(mockMcData);
    });

    test('resolves from object with version property', () => {
      const result = resolveMcData({ version: '1.19.2' });
      expect(result).toBeDefined();
      expect(result?.itemsByName).toBeDefined();
      expect(result?.items).toBeDefined();
      expect(result?.blocks).toBeDefined();
      expect(result?.recipes).toBeDefined();
    });

    test('returns undefined for invalid input', () => {
      expect(resolveMcData({})).toBeUndefined();
      expect(resolveMcData(123)).toBeUndefined();
      expect(resolveMcData([])).toBeUndefined();
    });
  });

  describe('ensureMinecraftDataFeaturesFiles', () => {
    test('does not throw errors', () => {
      expect(() => ensureMinecraftDataFeaturesFiles()).not.toThrow();
    });

    test('can be called multiple times safely', () => {
      expect(() => {
        ensureMinecraftDataFeaturesFiles();
        ensureMinecraftDataFeaturesFiles();
        ensureMinecraftDataFeaturesFiles();
      }).not.toThrow();
    });
  });
});
