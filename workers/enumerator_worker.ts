import { parentPort } from 'worker_threads';
import { ActionPath, TreeNode } from '../action_tree/types';
import { EnumerateMessage } from './types';
import { _internals } from '../planner';
import logger from '../utils/logger';
import { deserializeTree } from '../action_tree/serialize';

/**
 * Worker thread for enumerating action paths from a recipe tree
 * 
 * This worker handles the CPU-intensive task of generating paths
 * from a recipe tree using different enumeration strategies.
 */

if (!parentPort) {
  throw new Error('This module must be run as a worker thread');
}

parentPort.on('message', (msg: EnumerateMessage) => {
  logger.debug(`EnumeratorWorker: received message type=${msg?.type}`);
  
  if (!msg || msg.type !== 'enumerate') {
    logger.debug(`EnumeratorWorker: ignoring non-enumerate message`);
    return;
  }

  const { generator, tree: serializedTree, inventory, limit } = msg;
  logger.debug(`EnumeratorWorker: starting ${generator} enumeration (limit=${limit})`);
  logger.debug(`EnumeratorWorker: received tree action=${serializedTree?.action}, has context=${!!serializedTree?.context}`);

  try {
    const tree = deserializeTree(serializedTree);
    
    if (!tree) {
      logger.error(`EnumeratorWorker: tree is null after deserialization!`);
      throw new Error('Failed to deserialize tree');
    }
    
    logger.debug(`EnumeratorWorker: deserialized tree action=${tree.action}, has context=${!!tree.context}`);
    if (tree.context) {
      logger.debug(`EnumeratorWorker: context has inventory size=${tree.context.inventory?.size}, visited size=${tree.context.visited?.size}`);
    }

    let enumerate: (tree: TreeNode, options: { inventory?: Record<string, number> }) => Generator<ActionPath>;

    // Select the appropriate generator function
    if (generator === 'action') {
      enumerate = _internals.enumerateActionPathsGenerator;
    } else if (generator === 'shortest') {
      enumerate = _internals.enumerateShortestPathsGenerator;
    } else if (generator === 'lowest') {
      enumerate = _internals.enumerateLowestWeightPathsGenerator;
    } else {
      throw new Error('Unknown generator type: ' + generator);
    }

    logger.debug(`EnumeratorWorker: creating iterator for ${generator}`);
    const out: ActionPath[] = [];
    const iter = enumerate(tree, { inventory });
    let i = 0;

    logger.debug(`EnumeratorWorker: starting iteration for ${generator}`);
    for (const p of iter) {
      out.push(p);
      i += 1;
      if (Number.isFinite(limit) && limit !== undefined && i >= limit) break;
    }

    logger.debug(`EnumeratorWorker: ${generator} enumeration complete (${out.length} paths, iterated ${i} times)`);
    if (out.length === 0) {
      // Use debug (trace) verbosity so this does not surface in SILENT/INFO test output
      logger.debug(`EnumeratorWorker: ${generator} produced 0 paths - tree action=${tree.action}, operator=${tree.operator}`);
    }
    parentPort!.postMessage({ type: 'result', ok: true, paths: out });
  } catch (err) {
    const errorMsg = (err && (err as Error).stack) ? (err as Error).stack : String(err);
    logger.error(`EnumeratorWorker: ERROR - ${errorMsg}`);
    parentPort!.postMessage({ type: 'result', ok: false, error: errorMsg });
  }
});

