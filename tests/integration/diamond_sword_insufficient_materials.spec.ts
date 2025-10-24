import { plan } from '../../planner';
import minecraftData from 'minecraft-data';
import { WorldSnapshot } from '../../utils/worldSnapshotTypes';

describe('Diamond sword with insufficient diamonds', () => {
  const mcData = minecraftData('1.20.1');

  it('should NOT generate craft path when inventory has 1 diamond but 2 are needed and no diamond_ore in world', () => {
    const inventory = new Map([
      ['diamond', 1],
      ['stick', 5],
      ['crafting_table', 1]
    ]);

    const worldSnapshot: WorldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 32,
      yMin: -64,
      yMax: 320,
      blocks: {},
      entities: {}
    };

    const tree = plan(mcData, 'diamond_sword', 1, {
      inventory,
      pruneWithWorld: true,
      combineSimilarNodes: true,
      worldSnapshot,
      log: false
    });

    // Tree should have no viable children since we can't get the missing diamond
    expect(tree.children.variants.length).toBe(0);
  });

  it('should generate craft path when inventory has 1 diamond and diamond_ore IS in world', () => {
    const inventory = new Map([
      ['diamond', 1],
      ['stick', 5],
      ['crafting_table', 1],
      ['iron_pickaxe', 1]
    ]);

    const worldSnapshot: WorldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: -64,
      yMax: 320,
      blocks: {
        'diamond_ore': {
          count: 5,
          closestDistance: 20,
          averageDistance: 25
        },
        'deepslate_diamond_ore': {
          count: 3,
          closestDistance: 25,
          averageDistance: 30
        }
      },
      entities: {}
    };

    const tree = plan(mcData, 'diamond_sword', 1, {
      inventory,
      pruneWithWorld: true,
      combineSimilarNodes: true,
      worldSnapshot,
      log: false
    });

    // Tree should have viable children (can mine diamond_ore then craft)
    expect(tree.children.variants.length).toBeGreaterThan(0);
    
    // Check that at least one path involves mining
    let hasMiningPath = false;
    for (const variant of tree.children.variants) {
      if (variant.value.action === 'mine' || 
          (variant.value.action === 'craft' && variant.value.children?.variants?.some((c: any) => 
            c.value.action === 'root' && c.value.children?.variants?.some((cc: any) => cc.value.action === 'mine')
          ))) {
        hasMiningPath = true;
        break;
      }
    }
    expect(hasMiningPath).toBe(true);
  });

  it('should generate craft path when inventory already has 2+ diamonds', () => {
    const inventory = new Map([
      ['diamond', 3],
      ['stick', 5],
      ['crafting_table', 1]
    ]);

    const worldSnapshot: WorldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 32,
      yMin: -64,
      yMax: 320,
      blocks: {},
      entities: {}
    };

    const tree = plan(mcData, 'diamond_sword', 1, {
      inventory,
      pruneWithWorld: true,
      combineSimilarNodes: true,
      worldSnapshot,
      log: false
    });

    // Should have a simple craft path since we have all materials
    expect(tree.children.variants.length).toBeGreaterThan(0);
    
    // Should be a craft node (not mining since we have materials)
    const firstVariant = tree.children.variants[0].value;
    expect(firstVariant.action).toBe('craft');
  });

  it('should reproduce the exact bot scenario from logs', () => {
    // Exact inventory from logs line 9291
    const inventory = new Map([
      ['stone_pickaxe', 1],
      ['andesite', 18],
      ['granite', 54],
      ['coal', 2],
      ['stick', 7],
      ['diorite', 79],
      ['tuff', 5],
      ['cobbled_deepslate', 139],
      ['birch_planks', 1],
      ['mossy_cobblestone', 2],
      ['wooden_pickaxe', 1],
      ['diamond_helmet', 1],
      ['gravel', 12],
      ['oak_sapling', 1],
      ['diamond_chestplate', 1],
      ['diamond_leggings', 1],
      ['diamond', 1],  // Only 1 diamond!
      ['diamond_boots', 1],
      ['diamond_pickaxe', 1],
      ['diamond_shovel', 1],
      ['cobblestone', 141],
      ['crafting_table', 5],
      ['furnace', 1],
      ['iron_pickaxe', 1],
      ['raw_iron', 1]
    ]);

    // Empty world snapshot (radius 32 with 0 blocks as per logs)
    const worldSnapshot: WorldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 32,
      yMin: -64,
      yMax: 320,
      blocks: {},
      entities: {}
    };

    const tree = plan(mcData, 'diamond_sword', 1, {
      inventory,
      pruneWithWorld: true,
      combineSimilarNodes: true,
      worldSnapshot,
      log: false
    });

    console.log(`Tree has ${tree.children.variants.length} root variants`);
    
    // Before the fix: tree would incorrectly have craft variants
    // After the fix: tree should have NO variants (can't craft without materials)
    expect(tree.children.variants.length).toBe(0);
  });
});

