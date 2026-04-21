import { extractPaths } from '../../workers/planning_diagnostics';

describe('unit: worker_orchestrator diagnostics', () => {
  test('extractPaths round-trips the paths from envelopes in order', () => {
    const envelopes = [
      { generator: 'action' as const,   paths: [[{ step: 1 } as any]] },
      { generator: 'shortest' as const, paths: [] },
      { generator: 'lowest' as const,   paths: [[{ step: 2 } as any], [{ step: 3 } as any]] }
    ];
    const batches = extractPaths(envelopes);
    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(1);
    expect(batches[1].length).toBe(0);
    expect(batches[2].length).toBe(2);
  });
});
