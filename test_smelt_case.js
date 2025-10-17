const postBuildFilter = require('./dist/action_tree/builders/postBuildFilter');
const mcData = require('minecraft-data')('1.20.1');

const context = {
  inventory: new Map(),
  pruneWithWorld: true,
  visited: new Set(),
  depth: 0,
  parentPath: [],
  config: { preferMinimalTools: true, maxDepth: 10 },
  variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} },
  combineSimilarNodes: true
};

const tree = {
  action: 'root',
  children: {
    variants: [
      {
        value: {
          action: 'craft',
          result: { variants: [{ value: { item: 'iron_pickaxe' } }] },
          ingredients: { variants: [{ value: [ 
            { item: 'iron_ingot', perCraftCount: 3 }, 
            { item: 'stick', perCraftCount: 2 } 
          ] }] },
          children: {
            variants: [
              {
                value: {
                  action: 'root',
                  what: { variants: [{ value: 'iron_ingot' }] },
                  children: {
                    variants: [
                      {
                        value: {
                          action: 'smelt',
                          what: { variants: [{ value: 'furnace' }] },
                          result: { variants: [{ value: { item: 'iron_ingot', perSmelt: 1 } }] },
                          input: { variants: [{ value: { item: 'raw_iron', perSmelt: 1 } }] },
                          fuel: { variants: [{ value: 'coal' }] },
                          children: {
                            variants: [
                              {
                                value: {
                                  action: 'mine',
                                  what: { variants: [{ value: 'iron_ore' }] },
                                  targetItem: { variants: [{ value: 'raw_iron' }] }
                                }
                              }
                            ]
                          }
                        }
                      }
                    ]
                  }
                }
              }
            ]
          }
        }
      }
    ]
  }
};

console.log('Before filtering:');
console.log(`  Craft children: ${tree.children.variants[0].value.children.variants.length}`);
console.log(`  Required ingredients: iron_ingot, stick`);
console.log(`  Children provide: iron_ingot (via smelt)`);
console.log(`  Missing: stick (no child, not in inventory)`);

postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

console.log('\nAfter filtering:');
console.log(`  Tree children: ${tree.children.variants.length}`);
console.log(`  ${tree.children.variants.length === 0 ? 'REMOVED (correct - stick missing)' : 'KEPT (test expects this)'}`);
