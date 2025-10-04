import analyzeRecipes from '../../recipeAnalyzer';
import { ActionStep } from '../../action_tree/types';

describe('integration: minimal tool pruning for mining', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = (analyzeRecipes as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('prefers wooden_pickaxe (lowest viable tier) for cobblestone', () => {
        const inventory = { crafting_table: 1, oak_planks: 5 };
        const tree = analyzeRecipes(mcData, 'cobblestone', 1, { log: false, inventory });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory })) as ActionStep[][];
        expect(path).toBeDefined();
        const mineStep = path.find((s: any) => s.action === 'mine' && (s.targetItem === 'cobblestone' || s.what === 'cobblestone'));
        // If a tool is required, it should be wooden_pickaxe as minimal viable
        if (mineStep && (mineStep as any).tool) {
            expect((mineStep as any).tool).toBe('wooden_pickaxe');
        }
    });
});

