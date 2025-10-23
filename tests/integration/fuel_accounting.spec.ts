import plan from '../../planner';

describe('integration: fuel accounting for multiple smelts', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = (plan as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('smelting 9 stone consumes >=2 coal units in a valid path', () => {
        const inventory = new Map([['furnace', 1], ['cobblestone', 9], ['crafting_table', 1], ['oak_planks', 10], ['stone_pickaxe', 1]]);
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
            blocks: { oak_log: { count: 10, closestDistance: 5, averageDistance: 10 }, coal_ore: { count: 10, closestDistance: 8, averageDistance: 12 } },
            entities: {}
        };
        const tree = plan(mcData, 'stone', 9, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        // Use shortest paths generator for speed, just check first few paths
        let foundFuelOk = false;
        let checked = 0;
        for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
            const smeltSteps = path.filter((s: any) => s.action === 'smelt' && s.result && s.result.variants && s.result.variants[0] && s.result.variants[0].value.item === 'stone');
            let requiredCoal = 0;
            for (const st of smeltSteps) {
                const fuel = st.fuel && st.fuel.variants && st.fuel.variants[0] ? st.fuel.variants[0].value : null;
                if (fuel === 'coal') {
                    const count = Number(st.count) || 1;
                    const perFuel = 8; // from config
                    requiredCoal += Math.ceil(count / perFuel);
                }
            }
            if (requiredCoal >= 2) { foundFuelOk = true; break; }
            if (++checked >= 10) break; // limit search
        }
        expect(foundFuelOk).toBe(true);
    });
});

