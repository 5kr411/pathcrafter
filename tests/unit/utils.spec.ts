import plan from '../../planner';
import { ActionStep } from '../../action_tree/types';
import { rank } from '../../utils/items';

describe('unit: helpers', () => {
    const { chooseMinimalToolName, renderName } = (plan as any)._internals;

    test('chooseMinimalToolName prefers lower tier', () => {
        expect(chooseMinimalToolName(['iron_pickaxe', 'wooden_pickaxe', 'stone_pickaxe'])).toBe('wooden_pickaxe');
    });

    test('renderName returns name as is', () => {
        expect(renderName('oak_planks', {})).toBe('oak_planks');
    });
});

describe('unit: tier ranks', () => {
    const { chooseMinimalToolName } = (plan as any)._internals;

    test('correct ordering: wooden < stone < copper < iron < golden < diamond < netherite', () => {
        expect(rank('wooden_pickaxe')).toBeLessThan(rank('stone_pickaxe'));
        expect(rank('stone_pickaxe')).toBeLessThan(rank('copper_pickaxe'));
        expect(rank('copper_pickaxe')).toBeLessThan(rank('iron_pickaxe'));
        expect(rank('iron_pickaxe')).toBeLessThan(rank('golden_pickaxe'));
        expect(rank('golden_pickaxe')).toBeLessThan(rank('diamond_pickaxe'));
        expect(rank('diamond_pickaxe')).toBeLessThan(rank('netherite_pickaxe'));
    });

    test('chooseMinimalToolName picks stone_pickaxe over copper_pickaxe', () => {
        expect(chooseMinimalToolName(['copper_pickaxe', 'stone_pickaxe'])).toBe('stone_pickaxe');
    });

    test('rank returns 10 for unknown tiers', () => {
        expect(rank('mystery_pickaxe')).toBe(10);
    });
});

describe('unit: crafting table dependency', () => {
    const { enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator } = (plan as any)._internals;
    const mcData = (plan as any)._internals.resolveMcData('1.20.1');

    function usesTable(step: ActionStep): boolean { 
        return step && step.action === 'craft' && step.what.variants[0].value === 'table'; 
    }
    
    function produces(name: string, step: ActionStep): boolean {
        if (!step) return false;
        if (step.action === 'craft') return !!(step.result && step.result.variants[0].value.item === name);
        if (step.action === 'mine' || step.action === 'hunt') return ((step as any).targetItem?.variants[0].value || step.what.variants[0].value) === name;
        if (step.action === 'smelt') return !!(step.result && step.result.variants[0].value.item === name);
        return false;
    }
    
    function hasTableBeforeUse(path: ActionStep[]): boolean {
        let tables = 0;
        for (const st of path) {
            if (produces('crafting_table', st)) tables += (st.result && st.result.variants[0].value.perCraftCount ? st.result.variants[0].value.perCraftCount : 1) * (st.count || 1);
            if (usesTable(st)) { if (tables <= 0) return false; }
        }
        return true;
    }

    test('shortest paths never use table before acquiring one (empty inventory)', () => {
        const inventory = new Map();
        const tree = plan(mcData, 'wooden_pickaxe', 1, { log: false, inventory });
        let checked = 0;
        for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
            expect(hasTableBeforeUse(path)).toBe(true);
            if (++checked >= 25) break;
        }
    });

    test('lowest-weight paths never use table before acquiring one (empty inventory)', () => {
        const inventory = new Map();
        const tree = plan(mcData, 'stone_pickaxe', 1, { log: false, inventory });
        let checked = 0;
        for (const path of enumerateLowestWeightPathsGenerator(tree, { inventory })) {
            expect(hasTableBeforeUse(path)).toBe(true);
            if (++checked >= 25) break;
        }
    });
});

