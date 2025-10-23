import plan from '../../planner';
import { CraftNode, TreeNode } from '../../action_tree/types';
import { normalizeWoodSuffix } from '../../action_tree/utils/recipeUtils';
import { getIngredientSuffixKey } from '../../action_tree/builders/recipeGrouper';

describe('unit: aggressive wood grouping', () => {
  const { resolveMcData, buildRecipeTree } = (plan as any)._internals;
  const mcData = resolveMcData('1.20.1');

  describe('normalizeWoodSuffix', () => {
    it('should normalize log to wood_source', () => {
      expect(normalizeWoodSuffix('log')).toBe('wood_source');
    });

    it('should normalize wood to wood_source', () => {
      expect(normalizeWoodSuffix('wood')).toBe('wood_source');
    });

    it('should normalize stem to wood_source', () => {
      expect(normalizeWoodSuffix('stem')).toBe('wood_source');
    });

    it('should normalize hyphae to wood_source', () => {
      expect(normalizeWoodSuffix('hyphae')).toBe('wood_source');
    });

    it('should not normalize non-wood suffixes', () => {
      expect(normalizeWoodSuffix('planks')).toBe('planks');
      expect(normalizeWoodSuffix('ingot')).toBe('ingot');
      expect(normalizeWoodSuffix('ore')).toBe('ore');
    });
  });

  describe('getIngredientSuffixKey with wood normalization', () => {
    it('should produce same key for oak_log and crimson_stem recipes', () => {
      const oakLogRecipe = mcData.recipes[mcData.itemsByName['oak_planks'].id]
        .find((r: any) => {
          const ingredientIds = r.ingredients || r.inShape?.flat().filter((id: any) => id !== null);
          return ingredientIds?.some((id: number) => mcData.items[id]?.name === 'oak_log');
        });

      const crimsonStemRecipe = mcData.recipes[mcData.itemsByName['crimson_planks'].id]
        .find((r: any) => {
          const ingredientIds = r.ingredients || r.inShape?.flat().filter((id: any) => id !== null);
          return ingredientIds?.some((id: number) => mcData.items[id]?.name === 'crimson_stem');
        });

      if (oakLogRecipe && crimsonStemRecipe) {
        const oakKey = getIngredientSuffixKey(oakLogRecipe, mcData);
        const crimsonKey = getIngredientSuffixKey(crimsonStemRecipe, mcData);
        expect(oakKey).toBe(crimsonKey);
      }
    });

    it('should produce same key for oak_wood and warped_hyphae recipes', () => {
      const oakWoodRecipe = mcData.recipes[mcData.itemsByName['oak_planks'].id]
        .find((r: any) => {
          const ingredientIds = r.ingredients || r.inShape?.flat().filter((id: any) => id !== null);
          return ingredientIds?.some((id: number) => mcData.items[id]?.name === 'oak_wood');
        });

      const warpedHyphaeRecipe = mcData.recipes[mcData.itemsByName['warped_planks'].id]
        .find((r: any) => {
          const ingredientIds = r.ingredients || r.inShape?.flat().filter((id: any) => id !== null);
          return ingredientIds?.some((id: number) => mcData.items[id]?.name === 'warped_hyphae');
        });

      if (oakWoodRecipe && warpedHyphaeRecipe) {
        const oakKey = getIngredientSuffixKey(oakWoodRecipe, mcData);
        const warpedKey = getIngredientSuffixKey(warpedHyphaeRecipe, mcData);
        expect(oakKey).toBe(warpedKey);
      }
    });
  });

  describe('crafting_table with aggressive wood grouping', () => {
    it('should merge log/wood/stem/hyphae recipes into fewer craft nodes', () => {
      const tree = buildRecipeTree(mcData, 'crafting_table', 1, {
        log: false,
        inventory: new Map(),
        combineSimilarNodes: true
      });

      const planksCraftNodes: CraftNode[] = [];
      const findPlanksCraftNodes = (node: TreeNode) => {
        if (node.action === 'craft' && node.result) {
          const hasPlankResult = node.result.variants.some((v: any) =>
            v.value.item?.includes('planks')
          );
          if (hasPlankResult) {
            planksCraftNodes.push(node as CraftNode);
          }
        }
        if (node.children?.variants) {
          node.children.variants.forEach((child: any) => findPlanksCraftNodes(child.value));
        }
      };
      findPlanksCraftNodes(tree);

      expect(planksCraftNodes.length).toBeGreaterThan(0);

      const fourCountNodes = planksCraftNodes.filter(node => {
        const firstResult = node.result.variants[0]?.value;
        return (firstResult.perCraftCount || 1) === 4;
      });

      const twoCountNodes = planksCraftNodes.filter(node => {
        const firstResult = node.result.variants[0]?.value;
        return (firstResult.perCraftCount || 1) === 2;
      });

      expect(fourCountNodes.length).toBeGreaterThan(0);
      
      const mergedNode = fourCountNodes.find(node => {
        const ingredientVariants = node.ingredients?.variants || [];
        if (ingredientVariants.length <= 1) return false;

        const allIngredients = ingredientVariants.flatMap(v =>
          v.value.map((ing: any) => ing.item)
        );

        const hasLog = allIngredients.some((name: string) => name.includes('log'));
        const hasStem = allIngredients.some((name: string) => name.includes('stem'));
        
        return hasLog && hasStem;
      });

      expect(mergedNode).toBeDefined();
      
      if (twoCountNodes.length > 0) {
        const bambooNode = twoCountNodes.find(node => {
          const results = node.result.variants.map((v: any) => v.value.item);
          return results.some((item: string) => item === 'bamboo_planks');
        });
        
        if (bambooNode) {
          const fourCountIngredients = mergedNode?.ingredients.variants.flatMap((v: any) =>
            v.value.map((ing: any) => ing.item)
          ) || [];
          const bambooIngredients = bambooNode.ingredients.variants.flatMap((v: any) =>
            v.value.map((ing: any) => ing.item)
          );
          
          const hasOverlap = bambooIngredients.some((ing: string) =>
            fourCountIngredients.includes(ing)
          );
          expect(hasOverlap).toBe(false);
        }
      }
    });

    it('should group stripped variants with non-stripped variants', () => {
      const tree = buildRecipeTree(mcData, 'oak_planks', 4, {
        log: false,
        inventory: new Map(),
        combineSimilarNodes: true
      });

      const craftNodes: CraftNode[] = [];
      const findCraftNodes = (node: TreeNode) => {
        if (node.action === 'craft') {
          craftNodes.push(node as CraftNode);
        }
        if (node.children?.variants) {
          node.children.variants.forEach((child: any) => findCraftNodes(child.value));
        }
      };
      findCraftNodes(tree);

      const planksCraftNode = craftNodes.find(node =>
        node.result?.variants.some((v: any) => v.value.item === 'oak_planks')
      );

      if (planksCraftNode && planksCraftNode.ingredients?.variants.length > 1) {
        const allIngredients = planksCraftNode.ingredients.variants.flatMap(v =>
          v.value.map((ing: any) => ing.item)
        );

        const hasOakLog = allIngredients.includes('oak_log');
        const hasStrippedOakLog = allIngredients.includes('stripped_oak_log');

        expect(hasOakLog || hasStrippedOakLog).toBe(true);
      }
    });
  });

  describe('species-specific items maintain constraints', () => {
    it('cherry_stairs should only use cherry_planks', () => {
      const tree = buildRecipeTree(mcData, 'cherry_stairs', 4, {
        log: false,
        inventory: new Map(),
        combineSimilarNodes: true
      });

      const craftNodes: CraftNode[] = [];
      const findCraftNodes = (node: TreeNode) => {
        if (node.action === 'craft') {
          craftNodes.push(node as CraftNode);
        }
        if (node.children?.variants) {
          node.children.variants.forEach((child: any) => findCraftNodes(child.value));
        }
      };
      findCraftNodes(tree);

      const stairsCraftNode = craftNodes.find(node =>
        node.result?.variants.some((v: any) => v.value.item === 'cherry_stairs')
      );

      expect(stairsCraftNode).toBeDefined();

      if (stairsCraftNode && stairsCraftNode.ingredients?.variants) {
        const allIngredients = stairsCraftNode.ingredients.variants.flatMap(v =>
          v.value.map((ing: any) => ing.item)
        );

        const onlyCherryPlanks = allIngredients.every((item: string) =>
          item === 'cherry_planks'
        );

        expect(onlyCherryPlanks).toBe(true);
      }
    });

    it('oak_fence should only use oak items in its tree', () => {
      const tree = buildRecipeTree(mcData, 'oak_fence', 3, {
        log: false,
        inventory: new Map(),
        combineSimilarNodes: true
      });

      const craftNodes: CraftNode[] = [];
      const findCraftNodes = (node: TreeNode) => {
        if (node.action === 'craft') {
          craftNodes.push(node as CraftNode);
        }
        if (node.children?.variants) {
          node.children.variants.forEach((child: any) => findCraftNodes(child.value));
        }
      };
      findCraftNodes(tree);

      const fenceCraftNode = craftNodes.find(node =>
        node.result?.variants.some((v: any) => v.value.item === 'oak_fence')
      );

      if (fenceCraftNode && fenceCraftNode.ingredients?.variants) {
        const allIngredients = fenceCraftNode.ingredients.variants.flatMap(v =>
          v.value.map((ing: any) => ing.item)
        );

        const onlyOakItems = allIngredients.every((item: string) =>
          item.includes('oak') || item === 'stick'
        );

        expect(onlyOakItems).toBe(true);
      }
    });
  });

  describe('ingredient count preservation', () => {
    it('should preserve correct ingredient counts across merged variants', () => {
      const tree = buildRecipeTree(mcData, 'stick', 4, {
        log: false,
        inventory: new Map(),
        combineSimilarNodes: true
      });

      const craftNodes: CraftNode[] = [];
      const findCraftNodes = (node: TreeNode) => {
        if (node.action === 'craft') {
          craftNodes.push(node as CraftNode);
        }
        if (node.children?.variants) {
          node.children.variants.forEach((child: any) => findCraftNodes(child.value));
        }
      };
      findCraftNodes(tree);

      const planksCraftNodes = craftNodes.filter(node =>
        node.result?.variants.some((v: any) => v.value.item?.includes('planks'))
      );

      planksCraftNodes.forEach(node => {
        if (node.ingredients?.variants.length > 1) {
          const counts = node.ingredients.variants.map(v => {
            return v.value.reduce((sum: number, ing: any) => sum + (ing.perCraftCount || 0), 0);
          });

          const allSameCount = counts.every((c: number) => c === counts[0]);
          expect(allSameCount).toBe(true);
        }
      });
    });
  });

  describe('bamboo planks inclusion', () => {
    it('should include bamboo_planks in planks ingredient alternatives', () => {
      const tree = buildRecipeTree(mcData, 'crafting_table', 1, {
        log: false,
        inventory: new Map(),
        combineSimilarNodes: true
      });

      const findPlanksRootNode = (node: any): any => {
        if (node.action === 'root' && node.what?.variants) {
          const hasOakPlanks = node.what.variants.some((v: any) => v.value === 'oak_planks');
          const hasBambooPlanks = node.what.variants.some((v: any) => v.value === 'bamboo_planks');
          if (hasOakPlanks && hasBambooPlanks) {
            return node;
          }
        }
        if (node.children?.variants) {
          for (const child of node.children.variants) {
            const found = findPlanksRootNode(child.value);
            if (found) return found;
          }
        }
        return null;
      };

      const planksNode = findPlanksRootNode(tree);
      expect(planksNode).toBeDefined();
      
      if (planksNode) {
        const plankVariants = planksNode.what.variants.map((v: any) => v.value);
        expect(plankVariants).toContain('oak_planks');
        expect(plankVariants).toContain('bamboo_planks');
      }
    });
  });
});

