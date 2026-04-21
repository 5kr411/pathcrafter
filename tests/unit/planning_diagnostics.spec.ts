import {
  EnumResult,
  GeneratorFailure,
  collectGeneratorFailures,
  extractPaths
} from '../../workers/planning_diagnostics';

describe('unit: planning_diagnostics', () => {
  describe('collectGeneratorFailures', () => {
    test('returns empty array when no failures', () => {
      const results: EnumResult[] = [
        { generator: 'action',   paths: [[] as any] },
        { generator: 'shortest', paths: [[] as any] },
        { generator: 'lowest',   paths: [[] as any] }
      ];
      expect(collectGeneratorFailures(results)).toEqual([]);
    });

    test('extracts one timeout failure', () => {
      const results: EnumResult[] = [
        { generator: 'action',   paths: [] as any, failure: { kind: 'timeout', message: '30s exceeded', durationMs: 30000 } },
        { generator: 'shortest', paths: [[] as any] },
        { generator: 'lowest',   paths: [[] as any] }
      ];
      const failures: GeneratorFailure[] = collectGeneratorFailures(results);
      expect(failures.length).toBe(1);
      expect(failures[0].generator).toBe('action');
      expect(failures[0].kind).toBe('timeout');
      expect(failures[0].message).toBe('30s exceeded');
      expect(failures[0].durationMs).toBe(30000);
    });

    test('extracts multiple heterogeneous failures preserving order', () => {
      const results: EnumResult[] = [
        { generator: 'action',   paths: [] as any, failure: { kind: 'timeout', message: 't', durationMs: 30000 } },
        { generator: 'shortest', paths: [[] as any] },
        { generator: 'lowest',   paths: [] as any, failure: { kind: 'error',   message: 'boom', durationMs: 12 } }
      ];
      const failures = collectGeneratorFailures(results);
      expect(failures.length).toBe(2);
      expect(failures[0].generator).toBe('action');
      expect(failures[1].generator).toBe('lowest');
      expect(failures[1].kind).toBe('error');
    });
  });

  describe('extractPaths', () => {
    test('returns the per-generator paths in order', () => {
      const envelopes: EnumResult[] = [
        { generator: 'action',   paths: [[{ step: 1 } as any]] },
        { generator: 'shortest', paths: [] },
        { generator: 'lowest',   paths: [[{ step: 2 } as any], [{ step: 3 } as any]] }
      ];
      const batches = extractPaths(envelopes);
      expect(batches.length).toBe(3);
      expect(batches[0].length).toBe(1);
      expect(batches[1].length).toBe(0);
      expect(batches[2].length).toBe(2);
    });

    test('substitutes empty array when an envelope has no paths field', () => {
      const envelopes = [
        { generator: 'action' as const,   paths: undefined as any },
        { generator: 'shortest' as const, paths: [[{ x: 1 } as any]] },
        { generator: 'lowest' as const,   paths: null as any }
      ];
      const batches = extractPaths(envelopes);
      expect(batches[0]).toEqual([]);
      expect(batches[1].length).toBe(1);
      expect(batches[2]).toEqual([]);
    });
  });
});
