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
        const inventory = new Map([['stone_pickaxe', 1]]);
        const tree = plan(mc, 'raw_iron', 1, { log: false, inventory });
        const lwFirst = firstPathSteps(enumerateLowestWeightPathsGenerator(tree, { inventory }));
        const lwMines = lwFirst.filter((s: any) => s && s.action === 'mine').map((s: any) => s.what.variants[0].value);
        expect(lwMines).toContain('iron_ore');
        expect(lwMines).not.toContain('raw_iron_block');
    });

    test('x3 includes deepslate_iron_ore mining as an alternative (lowest-weight)', () => {
        const inventory = new Map([['stone_pickaxe', 1]]);
        const tree = plan(mc, 'raw_iron', 3, { log: false, inventory });
        const it = enumerateLowestWeightPathsGenerator(tree, { inventory });
        // Search a few paths for presence of raw_iron_block alternative
        let found = false;
        let checked = 0;
        for (const path of it) {
            const allMineVariants: string[] = [];
            for (const s of path) {
                if (s && s.action === 'mine') {
                    const variants = (s.what?.variants || []).map((v: any) => v.value);
                    allMineVariants.push(...variants);
                }
            }
            if (allMineVariants.includes('deepslate_iron_ore')) { found = true; break; }
            if (++checked >= 20) break;
        }
        expect(found).toBe(true);
    });
});

