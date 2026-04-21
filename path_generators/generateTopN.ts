import { ActionPath, TreeNode } from '../action_tree/types';
import { GeneratorOptions } from './types';
import { dedupePaths } from './utils/pathOperations';
import {
  executeGeneratorsInWorkers,
  executeGeneratorsInWorkersWithDiagnostics
} from './workerOrchestrator';
import { sortPathsByWeightAndDistance } from './sorting/pathSorter';
import { collectGeneratorFailures, GeneratorFailure } from '../workers/planning_diagnostics';

export interface GenerateTopNDiagnosticsResult {
  paths: ActionPath[];
  failures: GeneratorFailure[];
}

/**
 * Generates top N paths from multiple generator strategies using worker threads
 *
 * This function coordinates the entire path generation pipeline:
 * 1. Executes three generator strategies in parallel workers (action, shortest, lowest)
 * 2. Aggregates and deduplicates results
 * 3. Sorts by weight and distance
 *
 * @param tree - The recipe tree to enumerate paths from
 * @param options - Generation options including inventory and world snapshot
 * @param perGenerator - Number of paths to generate per strategy
 * @returns Promise resolving to sorted, deduplicated paths
 *
 * @see generateTopNPathsWithDiagnostics for the variant that also reports
 *      per-generator worker failures alongside the sorted path list.
 */
export async function generateTopNPathsFromGenerators(
  tree: TreeNode,
  options: GeneratorOptions,
  perGenerator: number
): Promise<ActionPath[]> {
  const inventory = options && options.inventory ? options.inventory : undefined;
  const snapshot = options && options.worldSnapshot ? options.worldSnapshot : null;

  const inventoryRecord = inventory instanceof Map
    ? Object.fromEntries(inventory.entries())
    : undefined;

  const results = await executeGeneratorsInWorkers(tree, inventoryRecord, perGenerator);

  const all = ([] as ActionPath[]).concat(...results);
  const unique = dedupePaths(all);

  return sortPathsByWeightAndDistance(unique, snapshot);
}

/**
 * Diagnostic variant: returns both the sorted path list and any per-generator
 * failure records (timeouts or worker errors). Consumers that want to surface
 * "planner infrastructure failed" vs. "legitimately no paths" should prefer
 * this entry point.
 */
export async function generateTopNPathsWithDiagnostics(
  tree: TreeNode,
  options: GeneratorOptions,
  perGenerator: number
): Promise<GenerateTopNDiagnosticsResult> {
  const inventory = options && options.inventory ? options.inventory : undefined;
  const snapshot = options && options.worldSnapshot ? options.worldSnapshot : null;

  const inventoryRecord = inventory instanceof Map
    ? Object.fromEntries(inventory.entries())
    : undefined;

  const envelopes = await executeGeneratorsInWorkersWithDiagnostics(tree, inventoryRecord, perGenerator);
  const failures = collectGeneratorFailures(envelopes);

  const all = ([] as ActionPath[]).concat(...envelopes.map(e => (Array.isArray(e.paths) ? e.paths : [])));
  const unique = dedupePaths(all);
  const sorted = sortPathsByWeightAndDistance(unique, snapshot);

  return { paths: sorted, failures };
}

export { dedupePaths, serializePath, takeN } from './utils/pathOperations';
