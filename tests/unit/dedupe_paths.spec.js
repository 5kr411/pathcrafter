const { dedupePaths, serializePath } = require('../../path_generators/generateTopN');

describe('dedupePaths', () => {
    test('removes exact duplicate paths', () => {
        const p1 = [{ action: 'mine', what: 'stone', count: 1 }];
        const p2 = [{ action: 'mine', what: 'stone', count: 1 }];
        const p3 = [{ action: 'mine', what: 'coal_ore', count: 1 }];
        const result = dedupePaths([p1, p2, p3, p1]);
        expect(result.length).toBe(2);
        const keys = result.map(serializePath).sort();
        expect(keys).toContain(JSON.stringify(p1));
        expect(keys).toContain(JSON.stringify(p3));
    });

    test('keeps distinct paths differing by any step field', () => {
        const a = [{ action: 'mine', what: 'stone', count: 1 }];
        const b = [{ action: 'mine', what: 'stone', count: 2 }];
        const c = [{ action: 'mine', what: 'stone', count: 1, tool: 'wooden_pickaxe' }];
        const result = dedupePaths([a, b, c]);
        expect(result.length).toBe(3);
    });
});


