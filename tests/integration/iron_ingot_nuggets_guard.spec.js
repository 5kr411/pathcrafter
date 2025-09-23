const plan = require('../../planner');

describe('integration: prevent crafting iron_ingot from nuggets without obtaining them', () => {
    const { resolveMcData, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, enumerateActionPathsGenerator } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    function normalizePath(path) {
        return path.map(s => {
            if (s.action === 'craft') {
                const ings = (s.ingredients || []).map(i => `${i.perCraftCount} ${i.item}`).join('+');
                const res = s.result ? `${s.result.perCraftCount} ${s.result.item}` : '?';
                return `craft ${s.what} ${s.count} ${ings}->${res}`;
            }
            if (s.action === 'smelt') return `smelt ${s.count} ${(s.input && s.input.item)}->${(s.result && s.result.item)}`;
            if (s.action === 'mine') return `mine ${(s.targetItem || s.what)} ${s.count}`;
            if (s.action === 'hunt') return `hunt ${(s.targetItem || s.what)} ${s.count}`;
            return `${s.action} ${s.what} ${s.count}`;
        }).join(' | ');
    }

    test('without nuggets in inventory, no generator includes 9 nuggets -> ingot craft (bounded)', () => {
        const inventory = { furnace: 1, coal: 1, raw_iron: 1 };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory });
        const gens = [
            Array.from(enumerateShortestPathsGenerator(tree, { inventory })),
            Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory })),
            Array.from(enumerateActionPathsGenerator(tree, { inventory }))
        ];
        for (const paths of gens) {
            const hasInvalid = paths.some(path => path.some(step => step.action === 'craft' && step.result?.item === 'iron_ingot' && (step.ingredients || []).some(i => i.item === 'iron_nugget')));
            expect(hasInvalid).toBe(false);
        }
    });

    test('with sufficient nuggets in inventory, nuggets craft path is allowed in all generators (bounded)', () => {
        const inventory = { iron_nugget: 9, crafting_table: 1, furnace: 1, coal: 1 };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory });
        const gens = [
            Array.from(enumerateShortestPathsGenerator(tree, { inventory })),
            Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory })),
            Array.from(enumerateActionPathsGenerator(tree, { inventory }))
        ];
        for (const paths of gens) {
            const hasExpected = paths.some(path => path.some(step => step.action === 'craft' && step.result?.item === 'iron_ingot' && (step.ingredients || []).some(i => i.item === 'iron_nugget')));
            expect(hasExpected).toBe(true);
        }
    });
});


