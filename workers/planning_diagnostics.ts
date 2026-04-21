import { ActionPath } from '../action_tree/types';

export type GeneratorName = 'action' | 'shortest' | 'lowest';

export interface EnumResult {
  generator: GeneratorName;
  paths: ActionPath[];
  failure?: { kind: 'timeout' | 'error'; message: string; durationMs: number };
}

export interface GeneratorFailure {
  generator: GeneratorName;
  kind: 'timeout' | 'error';
  message: string;
  durationMs: number;
}

/**
 * Extracts structured failure records from a batch of enumeration envelopes.
 * Returns an empty array if no envelope carries a `failure`.
 * Preserves input order.
 */
export function collectGeneratorFailures(results: EnumResult[]): GeneratorFailure[] {
  const out: GeneratorFailure[] = [];
  for (const r of results) {
    if (r && r.failure) {
      out.push({
        generator: r.generator,
        kind: r.failure.kind,
        message: r.failure.message,
        durationMs: r.failure.durationMs
      });
    }
  }
  return out;
}

/**
 * Returns the per-generator `paths` arrays in the input's order.
 * Substitutes `[]` when an envelope's paths field is null/undefined.
 */
export function extractPaths(results: EnumResult[]): ActionPath[][] {
  return results.map(r => (r && Array.isArray(r.paths)) ? r.paths : []);
}
