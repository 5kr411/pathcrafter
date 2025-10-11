import { buildRecipeTree } from '../../action_tree/build';
import { plan } from '../../planner';
import { enumerateActionPathsGenerator } from '../../path_generators/actionPathsGenerator';

describe('mine variant mode determination', () => {
  const { resolveMcData } = (plan as any)._internals;
  const mcData = resolveMcData('1.20.1');

  describe('logs should use one_of mode', () => {
    it('should set variantMode to one_of for log mining with combineSimilarNodes', () => {
      const tree = buildRecipeTree(
        { version: '1.20.1', mcData },
        'oak_log',
        1,
        {
          inventory: new Map(),
          combineSimilarNodes: true,
          depth: 0
        }
      );

      function findMineNodes(node: any): any[] {
        const results: any[] = [];
        
        if (node.action === 'mine' && !node.operator) {
          results.push(node);
        }
        
        if (node.children && node.children.variants) {
          for (const child of node.children.variants) {
            results.push(...findMineNodes(child.value));
          }
        }
        
        return results;
      }

      const mineNodes = findMineNodes(tree);
      
      expect(mineNodes.length).toBeGreaterThan(0);
      
      const logMineNodes = mineNodes.filter(node => 
        node.what.variants.some((v: any) => 
          typeof v.value === 'string' && v.value.includes('_log')
        )
      );
      
      expect(logMineNodes.length).toBeGreaterThan(0);
      
      logMineNodes.forEach(node => {
        const logVariants = node.what.variants.filter((v: any) => 
          typeof v.value === 'string' && v.value.includes('_log')
        );
        
        if (logVariants.length > 1) {
          expect(node.variantMode).toBe('one_of');
        }
      });
    });

    it('should propagate one_of mode to enumerated paths for logs', () => {
      const tree = buildRecipeTree(
        { version: '1.20.1', mcData },
        'stick',
        1,
        {
          inventory: new Map(),
          combineSimilarNodes: true,
          depth: 0
        }
      );

      const paths: any[] = [];
      const gen = enumerateActionPathsGenerator(tree, { inventory: new Map() });
      
      let count = 0;
      for (const path of gen) {
        paths.push(path);
        count++;
        if (count >= 10) break;
      }

      const miningSteps = paths.flatMap((path: any[]) => 
        path.filter(step => 
          step.action === 'mine' && 
          step.what.variants.some((v: any) => 
            typeof v.value === 'string' && v.value.includes('_log')
          )
        )
      );

      expect(miningSteps.length).toBeGreaterThan(0);

      miningSteps.forEach(step => {
        const logVariants = step.what.variants.filter((v: any) => 
          typeof v.value === 'string' && v.value.includes('_log')
        );
        
        if (logVariants.length > 1) {
          expect(step.variantMode).toBe('one_of');
        }
      });
    });
  });

  describe('ores should use any_of mode', () => {
    it('should set variantMode to any_of for diamond ore mining', () => {
      const tree = buildRecipeTree(
        { version: '1.20.1', mcData },
        'diamond',
        1,
        {
          inventory: new Map(),
          combineSimilarNodes: true,
          depth: 0
        }
      );

      function findMineNodes(node: any): any[] {
        const results: any[] = [];
        
        if (node.action === 'mine' && !node.operator) {
          results.push(node);
        }
        
        if (node.children && node.children.variants) {
          for (const child of node.children.variants) {
            results.push(...findMineNodes(child.value));
          }
        }
        
        return results;
      }

      const mineNodes = findMineNodes(tree);
      
      expect(mineNodes.length).toBeGreaterThan(0);
      
      const oreMineNodes = mineNodes.filter(node => 
        node.what.variants.some((v: any) => 
          typeof v.value === 'string' && (
            v.value.includes('diamond_ore') || 
            v.value.includes('deepslate_diamond_ore')
          )
        )
      );
      
      expect(oreMineNodes.length).toBeGreaterThan(0);
      
      oreMineNodes.forEach(node => {
        expect(node.variantMode).toBe('any_of');
      });
    });

    it('should set variantMode to any_of for iron ore mining', () => {
      const tree = buildRecipeTree(
        { version: '1.20.1', mcData },
        'raw_iron',
        1,
        {
          inventory: new Map(),
          combineSimilarNodes: true,
          depth: 0
        }
      );

      function findMineNodes(node: any): any[] {
        const results: any[] = [];
        
        if (node.action === 'mine' && !node.operator) {
          results.push(node);
        }
        
        if (node.children && node.children.variants) {
          for (const child of node.children.variants) {
            results.push(...findMineNodes(child.value));
          }
        }
        
        return results;
      }

      const mineNodes = findMineNodes(tree);
      
      expect(mineNodes.length).toBeGreaterThan(0);
      
      const oreMineNodes = mineNodes.filter(node => 
        node.what.variants.some((v: any) => 
          typeof v.value === 'string' && (
            v.value.includes('iron_ore') || 
            v.value.includes('deepslate_iron_ore')
          )
        )
      );
      
      expect(oreMineNodes.length).toBeGreaterThan(0);
      
      oreMineNodes.forEach(node => {
        const oreVariants = node.what.variants.filter((v: any) => 
          typeof v.value === 'string' && (
            v.value.includes('iron_ore') || 
            v.value.includes('deepslate_iron_ore')
          )
        );
        
        if (oreVariants.length >= 1) {
          expect(node.variantMode).toBe('any_of');
        }
      });
    });

    it('should propagate any_of mode to enumerated paths for ores', () => {
      const tree = buildRecipeTree(
        { version: '1.20.1', mcData },
        'diamond',
        1,
        {
          inventory: new Map(),
          combineSimilarNodes: true,
          depth: 0
        }
      );

      const paths: any[] = [];
      const gen = enumerateActionPathsGenerator(tree, { inventory: new Map() });
      
      let count = 0;
      for (const path of gen) {
        paths.push(path);
        count++;
        if (count >= 10) break;
      }

      const miningSteps = paths.flatMap((path: any[]) => 
        path.filter(step => 
          step.action === 'mine' && 
          step.what.variants.some((v: any) => 
            typeof v.value === 'string' && (
              v.value.includes('diamond_ore') || 
              v.value.includes('deepslate_diamond_ore')
            )
          )
        )
      );

      expect(miningSteps.length).toBeGreaterThan(0);

      miningSteps.forEach(step => {
        expect(step.variantMode).toBe('any_of');
      });
    });
  });

  describe('single block mining', () => {
    it('should use any_of mode for single block', () => {
      const tree = buildRecipeTree(
        { version: '1.20.1', mcData },
        'cobblestone',
        1,
        {
          inventory: new Map(),
          combineSimilarNodes: false,
          depth: 0
        }
      );

      function findMineNodes(node: any): any[] {
        const results: any[] = [];
        
        if (node.action === 'mine' && !node.operator) {
          results.push(node);
        }
        
        if (node.children && node.children.variants) {
          for (const child of node.children.variants) {
            results.push(...findMineNodes(child.value));
          }
        }
        
        return results;
      }

      const mineNodes = findMineNodes(tree);
      
      expect(mineNodes.length).toBeGreaterThan(0);
      
      mineNodes.forEach(node => {
        if (node.what.variants.length === 1) {
          expect(node.variantMode).toBe('any_of');
        }
      });
    });
  });
});


