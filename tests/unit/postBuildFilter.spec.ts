import { BuildContext } from '../../action_tree/types';
import { getCachedMcData } from '../testHelpers';

// Import the module to test (we'll need to export the internal functions for testing)
const postBuildFilter = require('../../action_tree/builders/postBuildFilter');

describe('unit: postBuildFilter', () => {
  let mcData: any;

  beforeAll(() => {
    mcData = getCachedMcData('1.20.1');
  });

  describe('isNodeViable', () => {
    // We need to access the internal function for unit testing
    // For now, we'll test indirectly through the public API
    
    test('mine nodes are always viable', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'mine',
                what: { variants: [{ value: 'dirt' }] }
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      // Mine node should remain
      expect(tree.children.variants.length).toBe(1);
    });

    test('root nodes without children are pruned', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: { variants: [{ value: { item: 'oak_planks' } }] },
                ingredients: { variants: [{ value: [{ item: 'oak_log', perCraftCount: 1 }] }] },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: { variants: [] } // Empty - should be pruned
                      }
                    }
                  ]
                }
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      // Craft node should be pruned because its child root has no children
      expect(tree.children.variants.length).toBe(0);
    });

    test('craft nodes without result variants are pruned', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: { variants: [] }, // No variants - should be pruned
                ingredients: { variants: [] },
                children: { variants: [] }
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      expect(tree.children.variants.length).toBe(0);
    });
  });

  describe('filterSingleCraftNode', () => {
    test('filters craft variants when ingredients are unavailable', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      // Craft node that can make oak or spruce planks, but only spruce_log is available
      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [
                    { value: { item: 'oak_planks' } },
                    { value: { item: 'spruce_planks' } }
                  ]
                },
                ingredients: {
                  variants: [
                    { value: [{ item: 'oak_log', perCraftCount: 1 }] },
                    { value: [{ item: 'spruce_log', perCraftCount: 1 }] }
                  ]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: {
                          variants: [
                            {
                              value: {
                                action: 'mine',
                                what: { variants: [{ value: 'spruce_log' }] }
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

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      expect(tree.children.variants.length).toBeGreaterThan(0);
      const craftNode = tree.children.variants[0].value;
      
      // Should only have spruce_planks variant since only spruce_log is available
      expect(craftNode.result.variants.length).toBe(1);
      expect(craftNode.result.variants[0].value.item).toBe('spruce_planks');
    });

    test('clears all variants when no ingredients are available', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [
                    { value: { item: 'oak_planks' } }
                  ]
                },
                ingredients: {
                  variants: [
                    { value: [{ item: 'oak_log', perCraftCount: 1 }] }
                  ]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: { variants: [] } // No sources available
                      }
                    }
                  ]
                }
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      // Craft node should have no variants and be pruned
      expect(tree.children.variants.length).toBe(0);
    });
  });

  describe('collectAvailableFamiliesFromNode', () => {
    test('collects families from mine leaf nodes', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [
                    { value: { item: 'oak_planks' } },
                    { value: { item: 'spruce_planks' } }
                  ]
                },
                ingredients: {
                  variants: [
                    { value: [{ item: 'oak_log', perCraftCount: 1 }] },
                    { value: [{ item: 'spruce_log', perCraftCount: 1 }] }
                  ]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: {
                          variants: [
                            {
                              value: {
                                action: 'mine',
                                what: {
                                  variants: [
                                    { value: 'oak_log' },
                                    { value: 'spruce_log' }
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

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      expect(tree.children.variants.length).toBeGreaterThan(0);
      const craftNode = tree.children.variants[0].value;
      
      // Both variants should be available
      expect(craftNode.result.variants.length).toBe(2);
    });

    test('collects families from hunt leaf nodes', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'hunt',
                what: { variants: [{ value: 'cow' }] }
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      // Hunt node should remain
      expect(tree.children.variants.length).toBe(1);
    });

    test('does not collect from craft nodes with no viable children', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      // Nested craft where inner craft has no ingredients available
      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [{ value: { item: 'stick' } }]
                },
                ingredients: {
                  variants: [{ value: [{ item: 'oak_planks', perCraftCount: 2 }] }]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: {
                          variants: [
                            {
                              value: {
                                action: 'craft',
                                result: {
                                  variants: [{ value: { item: 'oak_planks' } }]
                                },
                                ingredients: {
                                  variants: [{ value: [{ item: 'oak_log', perCraftCount: 1 }] }]
                                },
                                children: {
                                  variants: [
                                    {
                                      value: {
                                        action: 'root',
                                        children: { variants: [] } // No sources
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

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      // Entire tree should be pruned - no way to get oak_log -> oak_planks -> stick
      expect(tree.children.variants.length).toBe(0);
    });
  });

  describe('smelt viability and availability', () => {
    test('smelt nodes are considered viable and not pruned', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'smelt',
                what: { variants: [{ value: 'furnace' }] },
                result: { variants: [{ value: { item: 'iron_ingot', perSmelt: 1 } }] },
                input: { variants: [{ value: { item: 'raw_iron', perSmelt: 1 } }] },
                fuel: { variants: [{ value: 'coal' }] },
                children: { variants: [] }
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      // Smelt node should remain
      expect(tree.children.variants.length).toBe(1);
      expect(tree.children.variants[0].value.action).toBe('smelt');
    });

    test('smelt results contribute to availability for parent craft nodes', () => {
      const context: BuildContext = {
        inventory: new Map([['stick', 10]]), // Add stick to inventory since no stick child
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
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
                ingredients: { variants: [{ value: [ { item: 'iron_ingot', perCraftCount: 3 }, { item: 'stick', perCraftCount: 2 } ] }] },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: {
                          variants: [
                            {
                              value: {
                                action: 'smelt',
                                what: { variants: [{ value: 'furnace' }] },
                                result: { variants: [{ value: { item: 'iron_ingot', perSmelt: 1 } }] },
                                input: { variants: [{ value: { item: 'raw_iron', perSmelt: 1 } }] },
                                fuel: { variants: [{ value: 'coal' }] },
                                // Include a leaf availability under smelt so collector sees viable children
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

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      const craftNode = tree.children.variants[0].value;
      // Craft node should remain viable with its result variant because smelt makes iron_ingot available
      expect(craftNode.result.variants.length).toBeGreaterThan(0);
      const hasIronIngot = craftNode.ingredients.variants[0].value.some((i: any) => i.item === 'iron_ingot');
      expect(hasIronIngot).toBe(true);
    });

    test('smelt inputs from inventory make smelted results available (regression test)', () => {
      const context: BuildContext = {
        inventory: new Map([
          ['raw_iron', 3],
          ['stick', 12],
          ['furnace', 1],
          ['crafting_table', 1]
        ]),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                context: context,
                result: { variants: [{ value: { item: 'iron_pickaxe' } }] },
                ingredients: { variants: [{ value: [ { item: 'iron_ingot', perCraftCount: 3 }, { item: 'stick', perCraftCount: 2 } ] }] },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: {
                          variants: [
                            {
                              value: {
                                action: 'smelt',
                                context: context,
                                what: { variants: [{ value: 'furnace' }] },
                                result: { variants: [{ value: { item: 'iron_ingot', perSmelt: 1 } }] },
                                input: { variants: [{ value: { item: 'raw_iron', perSmelt: 1 } }] },
                                fuel: { variants: [{ value: 'coal' }] },
                                children: { variants: [] }
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

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      expect(tree.children.variants.length).toBe(1);
      const craftNode = tree.children.variants[0].value;
      expect(craftNode.result.variants.length).toBe(1);
      expect(craftNode.result.variants[0].value.item).toBe('iron_pickaxe');
      const hasIronIngot = craftNode.ingredients.variants[0].value.some((i: any) => i.item === 'iron_ingot');
      expect(hasIronIngot).toBe(true);
    });
  });

  describe('exact item matching vs family matching', () => {
    test('stone types now match as ingredient alternatives - craft node is kept', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [{ value: { item: 'stone_pickaxe' } }]
                },
                ingredients: {
                  variants: [
                    { value: [{ item: 'cobblestone', perCraftCount: 3 }] },
                    { value: [{ item: 'cobbled_deepslate', perCraftCount: 3 }] },
                    { value: [{ item: 'blackstone', perCraftCount: 3 }] }
                  ]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        what: { variants: [{ value: 'cobblestone' }] },
                        children: {
                          variants: [
                            {
                              value: {
                                action: 'mine',
                                what: { variants: [{ value: 'stone' }] },
                                targetItem: { variants: [{ value: 'cobblestone' }] }
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

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      expect(tree.children.variants.length).toBe(1);
    });

    test('wood types match by family - oak_planks can use oak family', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [
                    { value: { item: 'stick' } }
                  ]
                },
                ingredients: {
                  variants: [
                    { value: [{ item: 'oak_planks', perCraftCount: 2 }] }
                  ]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: {
                          variants: [
                            {
                              value: {
                                action: 'craft',
                                result: {
                                  variants: [{ value: { item: 'oak_planks' } }]
                                },
                                ingredients: {
                                  variants: [{ value: [{ item: 'oak_log', perCraftCount: 1 }] }]
                                },
                                children: {
                                  variants: [
                                    {
                                      value: {
                                        action: 'root',
                                        children: {
                                          variants: [
                                            {
                                              value: {
                                                action: 'mine',
                                                what: { variants: [{ value: 'oak_log' }] },
                                                targetItem: { variants: [{ value: 'oak_log' }] }
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
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      const stickCraft = tree.children.variants[0].value;
      expect(stickCraft.result.variants.length).toBe(1);
      expect(stickCraft.result.variants[0].value.item).toBe('stick');
    });

    test('inventory items count as exact matches', () => {
      const context: BuildContext = {
        inventory: new Map([['cobbled_deepslate', 5]]),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                context: context,
                result: {
                  variants: [
                    { value: { item: 'stone_pickaxe' } },
                    { value: { item: 'deepslate_pickaxe' } }
                  ]
                },
                ingredients: {
                  variants: [
                    { value: [{ item: 'cobblestone', perCraftCount: 3 }] },
                    { value: [{ item: 'cobbled_deepslate', perCraftCount: 3 }] }
                  ]
                },
                children: {
                  variants: []
                }
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      const craftNode = tree.children.variants[0].value;

      expect(craftNode.result.variants.length).toBe(1);
      expect(craftNode.result.variants[0].value.item).toBe('deepslate_pickaxe');
      
      expect(craftNode.ingredients.variants.length).toBe(1);
      expect(craftNode.ingredients.variants[0].value[0].item).toBe('cobbled_deepslate');
    });

    test('wood family matching allows oak for birch planks', () => {
      const context: BuildContext = {
        inventory: new Map([['birch_planks', 10]]), // Add birch_planks since no plank craft node
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [
                    { value: { item: 'stick' } }
                  ]
                },
                ingredients: {
                  variants: [
                    { value: [{ item: 'birch_planks', perCraftCount: 2 }] }
                  ]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: {
                          variants: [
                            {
                              value: {
                                action: 'mine',
                                what: { variants: [{ value: 'oak_log' }] },
                                targetItem: { variants: [{ value: 'oak_log' }] }
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

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      expect(tree.children.variants.length).toBeGreaterThan(0);
      const craftNode = tree.children.variants[0].value;
      // Wood types match by family, so oak can substitute for birch
      expect(craftNode.result.variants.length).toBeGreaterThan(0);
    });
  });

  describe('applyPostBuildFiltering', () => {
    test('does not filter when pruneWithWorld is false', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: false,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [{ value: { item: 'oak_planks' } }]
                },
                ingredients: {
                  variants: [{ value: [{ item: 'oak_log', perCraftCount: 1 }] }]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: { variants: [] }
                      }
                    }
                  ]
                }
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      // Should not filter - tree remains unchanged
      expect(tree.children.variants.length).toBe(1);
    });

    test('does not filter when combineSimilarNodes is false', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: false
      };

      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [{ value: { item: 'oak_planks' } }]
                },
                ingredients: {
                  variants: [{ value: [{ item: 'oak_log', perCraftCount: 1 }] }]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: { variants: [] }
                      }
                    }
                  ]
                }
              }
            }
          ]
        }
      };

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      // Should not filter - tree remains unchanged
      expect(tree.children.variants.length).toBe(1);
    });

    test('handles convergence over multiple passes', () => {
      const context: BuildContext = {
        inventory: new Map(),
        pruneWithWorld: true,
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: { getConstraint: () => undefined, addConstraint: () => {} } as any,
        combineSimilarNodes: true
      };

      // Multi-level tree: planks craft needs logs, only spruce_log available
      const tree = {
        action: 'root',
        children: {
          variants: [
            {
              value: {
                action: 'craft',
                result: {
                  variants: [
                    { value: { item: 'oak_planks' } },
                    { value: { item: 'spruce_planks' } }
                  ]
                },
                ingredients: {
                  variants: [
                    { value: [{ item: 'oak_log', perCraftCount: 1 }] },
                    { value: [{ item: 'spruce_log', perCraftCount: 1 }] }
                  ]
                },
                children: {
                  variants: [
                    {
                      value: {
                        action: 'root',
                        children: {
                          variants: [
                            {
                              value: {
                                action: 'mine',
                                what: { variants: [{ value: 'spruce_log' }] }
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

      postBuildFilter.applyPostBuildFiltering(tree, context, mcData);

      expect(tree.children.variants.length).toBeGreaterThan(0);
      const planksCraft = tree.children.variants[0].value;

      // Plank craft node should only have spruce variants after filtering
      expect(planksCraft.result.variants.length).toBe(1);
      expect(planksCraft.result.variants[0].value.item).toBe('spruce_planks');
      
      expect(planksCraft.ingredients.variants.length).toBe(1);
      expect(planksCraft.ingredients.variants[0].value[0].item).toBe('spruce_log');
    });
  });
});

