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
            blocks: {
                iron_ore: { count: 1, closestDistance: 15, averageDistance: 15 }
            },
            entities: {}
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
            blocks: {
                oak_log: { count: 2, closestDistance: 1, averageDistance: 2 },
                spruce_log: { count: 1, closestDistance: 2, averageDistance: 2 }
            },
            entities: {}
        };
        const enabled = filterPathsByWorldSnapshot([path], snapshot);
        expect(enabled.length).toBe(1);

        const disabled = filterPathsByWorldSnapshot([path], snapshot, { disableGenericWood: true });
        expect(disabled.length).toBe(0);

        const speciesPath = [{ action: 'mine', what: 'oak_log', count: 2 }];
        const speciesOk = filterPathsByWorldSnapshot([speciesPath], snapshot, { disableGenericWood: true });
        expect(speciesOk.length).toBe(1);
    });

    test('missing block fails filter', () => {
        const path = [ { action: 'mine', what: 'iron_ore', count: 1 } ];
        const snapshot = { version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, yMin: 0, yMax: 255, blocks: {}, entities: {} };
        const result = filterPathsByWorldSnapshot([path], snapshot);
        expect(result.length).toBe(0);
    });
});
