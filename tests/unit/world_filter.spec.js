const { filterPathsByWorldSnapshot } = require('../../path_filters');

describe('unit: world filtering', () => {
    test('single mine step passes when world snapshot contains the block', () => {
        const path = [
            { action: 'mine', what: 'iron_ore', count: 1 }
        ];
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 1,
            yMin: 0,
            yMax: 255,
            blocks: [
                { x: 10, y: 60, z: 10, name: 'iron_ore', id: 44, stateId: 131 }
            ],
            entities: []
        };
        const result = filterPathsByWorldSnapshot([path], snapshot);
        expect(result.length).toBe(1);
        expect(result[0]).toBe(path);
    });

    test('generic wood demand passes when any species exists', () => {
        const path = [
            { action: 'mine', what: 'generic_log', count: 2 }
        ];
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 1,
            yMin: 0,
            yMax: 255,
            blocks: [
                { x: 1, y: 64, z: 1, name: 'oak_log' },
                { x: 2, y: 64, z: 2, name: 'spruce_log' }
            ],
            entities: []
        };
        const result = filterPathsByWorldSnapshot([path], snapshot);
        expect(result.length).toBe(1);
    });

    test('missing block fails filter', () => {
        const path = [ { action: 'mine', what: 'iron_ore', count: 1 } ];
        const snapshot = { version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, yMin: 0, yMax: 255, blocks: [], entities: [] };
        const result = filterPathsByWorldSnapshot([path], snapshot);
        expect(result.length).toBe(0);
    });
});
