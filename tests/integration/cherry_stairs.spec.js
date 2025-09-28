const analyzeRecipes = require('../../recipeAnalyzer');

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

describe('integration: cherry_stairs generic vs species-specific wood', () => {
    const { resolveMcData, enumerateShortestPathsGenerator, renderName } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('uses generic planks for crafting_table and cherry_planks for stairs', () => {
        const tree = analyzeRecipes(mcData, 'cherry_stairs', 1, { log: false, inventory: {} });
        const paths = Array.from(enumerateShortestPathsGenerator(tree, { inventory: {} })).map(p => ({ raw: p, s: normalizePath(p) }));

        // find a path that crafts a crafting_table with an ingredient rendered as generic_planks
        const hasGenericTable = paths.some(({ raw }) => raw.some(step => step.action === 'craft' && step.result?.item === 'crafting_table' && (step.ingredients || []).some(i => renderName(i.item, i.meta) === 'generic_planks')));
        expect(hasGenericTable).toBe(true);

        // find a path that crafts cherry_stairs using cherry_planks specifically
        const hasCherryStairs = paths.some(({ raw }) => raw.some(step => step.action === 'craft' && step.result?.item === 'cherry_stairs' && (step.ingredients || []).some(i => renderName(i.item, i.meta) === 'cherry_planks')));
        expect(hasCherryStairs).toBe(true);
    });

    test('disabling generic wood avoids generic_planks in crafting_table steps', () => {
        const { setGenericWoodEnabled } = require('../../utils/config');
        const prev = require('../../utils/config').getGenericWoodEnabled();
        try {
            setGenericWoodEnabled(false);
            const tree = analyzeRecipes(mcData, 'cherry_stairs', 1, { log: false, inventory: {} });
            const paths = Array.from(enumerateShortestPathsGenerator(tree, { inventory: {} }));
            const hasGenericTable = paths.some(raw => raw.some(step => step.action === 'craft' && step.result?.item === 'crafting_table' && (step.ingredients || []).some(i => renderName(i.item, i.meta) === 'generic_planks')));
            expect(hasGenericTable).toBe(false);
        } finally {
            setGenericWoodEnabled(prev);
        }
    });
});


