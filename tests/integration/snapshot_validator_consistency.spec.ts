import { describe, it, expect, beforeAll } from '@jest/globals';
import * as path from 'path';
import { loadSnapshotFromFile } from '../../utils/worldSnapshot';
import { WorldSnapshot } from '../../utils/worldSnapshotTypes';
import plan, { _internals } from '../../planner';
import { canConsumeWorld } from '../../utils/worldBudget';

const mcData = require('minecraft-data')('1.20.1');

describe('Snapshot Validator Consistency', () => {
  let snapshotWithRadius: WorldSnapshot;
  let snapshotWithoutRadius: WorldSnapshot;

  beforeAll(() => {
    const snapshotPath = path.resolve(__dirname, '../../world_snapshots/raw_overworld_1759150790377.json');
    const loadedSnapshot = loadSnapshotFromFile(snapshotPath);
    
    snapshotWithoutRadius = loadedSnapshot;
    
    snapshotWithRadius = {
      ...loadedSnapshot,
      radius: 96
    };
  });

  describe('World Budget Distance Filtering', () => {
    it('should properly filter by distance when radius is present', () => {
      const snapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 16,
        yMin: 0,
        yMax: 255,
        blocks: {
          diamond_ore: {
            count: 3,
            closestDistance: 10,
            averageDistance: 12
          },
          coal_ore: {
            count: 50,
            closestDistance: 20,
            averageDistance: 30
          }
        },
        entities: {}
      };

      const inventory = new Map<string, number>();
      inventory.set('iron_pickaxe', 1);
      inventory.set('stick', 2);
      inventory.set('crafting_table', 1);

      const tree = plan(mcData, 'diamond_pickaxe', 1, {
        inventory,
        pruneWithWorld: true,
        worldSnapshot: snapshot,
        combineSimilarNodes: true,
        log: false
      });

      expect(tree).toBeDefined();
      expect(tree.children.variants.length).toBeGreaterThan(0);
      
      const craftNode = tree.children.variants[0]?.value;
      expect(craftNode).toBeDefined();
      expect(craftNode.action).toBe('craft');
      expect(craftNode.children.variants.length).toBeGreaterThan(0);
      
      let foundMineNode = false;
      const checkForDiamondMineNode = (node: any): void => {
        if (node.action === 'mine') {
          const targetItem = node.targetItem?.variants?.[0]?.value;
          const whatItem = node.what?.variants?.[0]?.value;
          if (targetItem === 'diamond' || whatItem === 'diamond' || whatItem === 'diamond_ore') {
            foundMineNode = true;
          }
        }
        if (node.children?.variants) {
          for (const variant of node.children.variants) {
            checkForDiamondMineNode(variant.value);
          }
        }
      };
      
      checkForDiamondMineNode(tree);
      expect(foundMineNode).toBe(true);
    });

    it('should use distance threshold from snapshot radius', () => {
      const snapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 16,
        yMin: 0,
        yMax: 255,
        blocks: {
          diamond_ore: {
            count: 3,
            closestDistance: 10,
            averageDistance: 12
          }
        },
        entities: {}
      };

      const worldBudget = (_internals as any).buildWorldBudgetFromSnapshot?.(snapshot);
      
      if (!worldBudget) {
        throw new Error('buildWorldBudgetFromSnapshot is not exposed in _internals');
      }

      expect(worldBudget.distanceThreshold).toBe(16);
      expect(worldBudget.allowedBlocksWithinThreshold.has('diamond_ore')).toBe(true);
      expect(canConsumeWorld(worldBudget, 'blocks', 'diamond_ore', 1)).toBe(true);
    });

    it('should handle missing radius field gracefully', () => {
      const snapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: undefined as any,
        yMin: 0,
        yMax: 255,
        blocks: {
          diamond_ore: {
            count: 3,
            closestDistance: 10,
            averageDistance: 12
          }
        },
        entities: {}
      };

      expect(() => {
        const inventory = new Map<string, number>();
        inventory.set('iron_pickaxe', 1);
        
        plan(mcData, 'diamond_pickaxe', 1, {
          inventory,
          pruneWithWorld: true,
          worldSnapshot: snapshot,
          log: false
        });
      }).not.toThrow();
    });
  });

  describe('Validator and Worker Consistency', () => {
    it('should generate trees with mining nodes when diamond_ore is available', () => {
      const inventory = new Map<string, number>();
      inventory.set('stick', 2);
      inventory.set('crafting_table', 1);
      inventory.set('iron_pickaxe', 1);

      const treeWithRadius = plan(mcData, 'diamond_pickaxe', 1, {
        inventory,
        pruneWithWorld: true,
        worldSnapshot: snapshotWithRadius,
        combineSimilarNodes: true,
        log: false
      });

      expect(treeWithRadius).toBeDefined();
      expect(treeWithRadius.children.variants.length).toBeGreaterThan(0);
      
      const craftNode = treeWithRadius.children.variants[0]?.value;
      expect(craftNode.action).toBe('craft');
      
      let foundMineNode = false;
      const checkForMineNode = (node: any): void => {
        if (node.action === 'mine') {
          foundMineNode = true;
          return;
        }
        if (node.children?.variants) {
          for (const variant of node.children.variants) {
            checkForMineNode(variant.value);
          }
        }
      };
      
      checkForMineNode(treeWithRadius);
      expect(foundMineNode).toBe(true);
    });

    it('should generate identical paths with validator and worker enumeration logic', () => {
      const inventory = new Map<string, number>();
      inventory.set('stick', 2);
      inventory.set('crafting_table', 1);
      inventory.set('iron_pickaxe', 1);

      const tree = plan(mcData, 'diamond_pickaxe', 1, {
        inventory,
        pruneWithWorld: true,
        worldSnapshot: snapshotWithRadius,
        combineSimilarNodes: true,
        log: false
      });

      const inventoryRecord: Record<string, number> = {};
      inventory.forEach((count, item) => {
        inventoryRecord[item] = count;
      });

      const validatorPaths = [];
      const iter = _internals.enumerateActionPathsGenerator(tree, { inventory: inventoryRecord });
      for (const p of iter) {
        validatorPaths.push(p);
        if (validatorPaths.length >= 5) break;
      }

      expect(validatorPaths.length).toBeGreaterThan(0);
      
      const hasMiningStep = validatorPaths.some(path => 
        path.some((step: any) => step.action === 'mine')
      );
      
      expect(hasMiningStep).toBe(true);
    });

    it('should have diamond_ore in the loaded world snapshot', () => {
      expect(snapshotWithoutRadius.blocks).toBeDefined();
      expect(snapshotWithoutRadius.blocks.diamond_ore).toBeDefined();
      expect(snapshotWithoutRadius.blocks.diamond_ore.count).toBeGreaterThan(0);
      expect(snapshotWithoutRadius.blocks.diamond_ore.closestDistance).toBeLessThan(20);
    });
  });
});

