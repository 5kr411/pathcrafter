import { ActionStep } from '../../action_tree/types';
import analyzeRecipes from '../../recipeAnalyzer';

describe('integration: hunting feathers with no inventory', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = (analyzeRecipes as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('yields a hunt action for chicken (feather source)', () => {
        const tree = analyzeRecipes(mcData, 'feather', 1, { log: false, inventory: new Map() });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory: new Map() })) as ActionStep[][];
        expect(path).toBeDefined();
        expect(path.some((step: any) => step.action === 'hunt')).toBe(true);
    });
});

