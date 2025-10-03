import { parentPort } from 'worker_threads';
import { ActionPath, TreeNode } from '../action_tree/types';
import { EnumerateMessage } from './types';

const planner = require('../../planner');
const logger = require('../../utils/logger');

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

  const { generator, tree, inventory, limit } = msg;
  logger.debug(`EnumeratorWorker: starting ${generator} enumeration (limit=${limit})`);

  try {
    let enumerate: (tree: TreeNode, options: { inventory?: Record<string, number> }) => Generator<ActionPath>;

    // Select the appropriate generator function
    if (generator === 'action') {
      enumerate = planner._internals.enumerateActionPathsGenerator;
    } else if (generator === 'shortest') {
      enumerate = planner._internals.enumerateShortestPathsGenerator;
    } else if (generator === 'lowest') {
      enumerate = planner._internals.enumerateLowestWeightPathsGenerator;
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

    logger.debug(`EnumeratorWorker: ${generator} enumeration complete (${out.length} paths)`);
    parentPort!.postMessage({ type: 'result', ok: true, paths: out });
  } catch (err) {
    const errorMsg = (err && (err as Error).stack) ? (err as Error).stack : String(err);
    logger.info(`EnumeratorWorker: ERROR - ${errorMsg}`);
    parentPort!.postMessage({ type: 'result', ok: false, error: errorMsg });
  }
});

