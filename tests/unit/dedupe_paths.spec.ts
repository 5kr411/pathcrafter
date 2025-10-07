import { dedupePaths, serializePath } from '../../path_generators/generateTopN';
import { ActionStep } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup } from '../testHelpers';

describe.skip('unit: dedupePaths', () => {
    test('removes exact duplicate paths', () => {
        const p1: ActionStep[] = [createTestActionStep({ action: 'mine', what: createTestStringGroup('stone'), count: 1 })];
        const p2: ActionStep[] = [createTestActionStep({ action: 'mine', what: createTestStringGroup('stone'), count: 1 })];
        const p3: ActionStep[] = [createTestActionStep({ action: 'mine', what: createTestStringGroup('coal_ore'), count: 1 })];
        const result = dedupePaths([p1, p2, p3, p1]);
        expect(result.length).toBe(2);
        const keys = result.map(serializePath).sort();
        expect(keys).toContain(JSON.stringify(p1));
        expect(keys).toContain(JSON.stringify(p3));
    });

    test('keeps distinct paths differing by any step field', () => {
        const a: ActionStep[] = [createTestActionStep({ action: 'mine', what: createTestStringGroup('stone'), count: 1 })];
        const b: ActionStep[] = [createTestActionStep({ action: 'mine', what: createTestStringGroup('stone'), count: 2 })];
        const c: ActionStep[] = [createTestActionStep({ action: 'mine', what: createTestStringGroup('stone'), count: 1 })];
        const result = dedupePaths([a, b, c]);
        expect(result.length).toBe(3);
    });
});

