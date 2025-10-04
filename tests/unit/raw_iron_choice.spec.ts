import plan from '../../planner';

describe('unit: raw_iron choice with stone_pickaxe in inventory', () => {
    const mc = (plan as any)._internals.resolveMcData('1.20.1');
    const { enumerateLowestWeightPathsGenerator } = (plan as any)._internals;

    function firstPathSteps(gen: any) {
        const it = gen[Symbol.iterator]();
        const n = it.next();
        return n && n.value ? n.value : [];
    }

    test('x1 prefers iron_ore over raw_iron_block (lowest-weight)', () => {
        const inventory = { stone_pickaxe: 1 };
        const tree = plan(mc, 'raw_iron', 1, { log: false, inventory });
        const lwFirst = firstPathSteps(enumerateLowestWeightPathsGenerator(tree, { inventory }));
        const lwMines = lwFirst.filter((s: any) => s && s.action === 'mine').map((s: any) => s.what);
        expect(lwMines).toContain('iron_ore');
        expect(lwMines).not.toContain('raw_iron_block');
    });

    test('x3 prefers raw_iron_block over iron_ore (lowest-weight)', () => {
        const inventory = { stone_pickaxe: 1 };
        const tree = plan(mc, 'raw_iron', 3, { log: false, inventory });
        const lwFirst = firstPathSteps(enumerateLowestWeightPathsGenerator(tree, { inventory }));
        const lwMines = lwFirst.filter((s: any) => s && s.action === 'mine').map((s: any) => s.what);
        expect(lwMines).toContain('raw_iron_block');
    });
});

