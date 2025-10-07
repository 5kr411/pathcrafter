import analyzeRecipes from '../../recipeAnalyzer';
import { ActionStep } from '../../action_tree/types';

describe('integration: smelting stone with inventory items present', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = (analyzeRecipes as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('with furnace+coal+cobblestone in inventory, shortest path is a single smelt', () => {
        const inventory = { furnace: 1, coal: 1, cobblestone: 1 };
        const tree = analyzeRecipes(mcData, 'stone', 1, { log: false, inventory });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory })) as ActionStep[][];
        expect(path).toBeDefined();
        expect(path.length).toBe(1);
        expect(path[0].action).toBe('smelt');
        expect(path[0].fuel?.variants[0].value).toBe('coal');
        expect(path[0].input?.variants[0].value.item).toBe('cobblestone');
        expect(path[0].result!.variants[0].value.item).toBe('stone');
    });
});

