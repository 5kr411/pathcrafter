// This test suite is no longer relevant with tree-level world pruning.
// Keep a minimal stub to ensure module loads, but do not assert filtering behavior here.
import * as pathFilters from '../../path_filters';

describe('unit: world filtering (deprecated)', () => {
    test('module loads and exposes functions', () => {
        expect(typeof pathFilters.generateTopNAndFilter).toBe('function')
    })
})

