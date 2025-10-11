import { BuildContext } from '../../action_tree/types';

// Import the module to test (we'll need to export the internal functions for testing)
const postBuildFilter = require('../../action_tree/builders/postBuildFilter');

describe('unit: postBuildFilter', () => {
  let mcData: any;

  beforeEach(() => {
    mcData = require('minecraft-data')('1.20.1');
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

      const craftNode = tree.children.variants[0].value;
      
      // Should only have spruce_planks variant
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

      const planksCraft = tree.children.variants[0].value;

      // Plank craft node should only have spruce variants after filtering
      expect(planksCraft.result.variants.length).toBe(1);
      expect(planksCraft.result.variants[0].value.item).toBe('spruce_planks');
      
      expect(planksCraft.ingredients.variants.length).toBe(1);
      expect(planksCraft.ingredients.variants[0].value[0].item).toBe('spruce_log');
    });
  });
});

