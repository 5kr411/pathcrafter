import analyzeRecipes from '../../recipeAnalyzer';
import { ActionStep } from '../../action_tree/types';

describe('unit: helpers', () => {
    const { chooseMinimalToolName, renderName } = (analyzeRecipes as any)._internals;

    test('chooseMinimalToolName prefers lower tier', () => {
        expect(chooseMinimalToolName(['iron_pickaxe', 'wooden_pickaxe', 'stone_pickaxe'])).toBe('wooden_pickaxe');
    });

    test('renderName returns name as is', () => {
        expect(renderName('oak_planks', {})).toBe('oak_planks');
    });
});

describe('unit: crafting table dependency', () => {
    const { enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator } = (analyzeRecipes as any)._internals;
    const mcData = (analyzeRecipes as any)._internals.resolveMcData('1.20.1');

    function usesTable(step: ActionStep): boolean { 
        return step && step.action === 'craft' && step.what === 'table'; 
    }
    
    function produces(name: string, step: ActionStep): boolean {
        if (!step) return false;
        if (step.action === 'craft') return !!(step.result && step.result.item === name);
        if (step.action === 'mine' || step.action === 'hunt') return ((step as any).targetItem || step.what) === name;
        if (step.action === 'smelt') return !!(step.result && step.result.item === name);
        return false;
    }
    
    function hasTableBeforeUse(path: ActionStep[]): boolean {
        let tables = 0;
        for (const st of path) {
            if (produces('crafting_table', st)) tables += (st.result && st.result.perCraftCount ? st.result.perCraftCount : 1) * (st.count || 1);
            if (usesTable(st)) { if (tables <= 0) return false; }
        }
        return true;
    }

    test('shortest paths never use table before acquiring one (empty inventory)', () => {
        const inventory = {};
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory });
        let checked = 0;
        for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
            expect(hasTableBeforeUse(path)).toBe(true);
            if (++checked >= 25) break;
        }
    });

    test('lowest-weight paths never use table before acquiring one (empty inventory)', () => {
        const inventory = {};
        const tree = analyzeRecipes(mcData, 'stone_pickaxe', 1, { log: false, inventory });
        let checked = 0;
        for (const path of enumerateLowestWeightPathsGenerator(tree, { inventory })) {
            expect(hasTableBeforeUse(path)).toBe(true);
            if (++checked >= 25) break;
        }
    });
});

