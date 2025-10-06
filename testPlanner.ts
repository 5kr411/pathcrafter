import * as fs from 'fs';
import * as path from 'path';
import { plan } from './planner';
import { filterPathsByWorldSnapshot, generateTopNAndFilter } from './path_filters';
import { getDefaultPerGeneratorPaths, getPruneWithWorldEnabled } from './utils/config';
import { hoistMiningInPaths } from './path_optimizations/hoistMining';
import { loadSnapshotFromFile } from './utils/worldSnapshot';
import { generateTopNPathsFromGenerators } from './path_generators/generateTopN';
import logger from './utils/logger';
import { logActionTree } from './action_tree/logger';

const { resolveMcData } = (plan as any)._internals;

// Project-wide config for this demo run
const mcData = resolveMcData('1.20.1');

const item = 'wooden_pickaxe';
const count = 1;
const inventory = { /*cobblestone: 2, stick: 2, crafting_table: 1 */ };
const combineSimilarNodes = true; // Set to false to see full tree explosion
logger.info(`Analyzing target item: ${item} x${count}`);
logger.info(`\nUsing inventory: ${JSON.stringify(inventory)}`);
logger.info(`\nCombine similar nodes: ${combineSimilarNodes}`);
const tree = plan(mcData, item, count, { log: false, inventory, combineSimilarNodes });

// demo logging disabled

const { computeTreeMaxDepth, countActionPaths } = (plan as any)._internals;
logger.info(`\nGenerated action tree with max depth: ${computeTreeMaxDepth(tree)}`);

// log the tree
logger.info(`\nGenerated action tree:`);
logActionTree(tree);

logger.info(`\nTotal paths: ${countActionPaths(tree)}`);

let pathsToLog = 10;

// listing disabled

// listing disabled

// listing disabled

const perGenerator = getDefaultPerGeneratorPaths();
(async () => {
    const aggregatedRaw = await generateTopNPathsFromGenerators(tree, { inventory }, perGenerator);
    const aggregated = hoistMiningInPaths(aggregatedRaw);

    // listing disabled

    // World filtering demo using snapshot from world-snapshots directory
    try {
        const snapshotsDir = path.resolve(__dirname, '../world_snapshots');
        const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
            const withTimes = files.map(f => {
                const full = path.join(snapshotsDir, f);
                const stat = fs.statSync(full);
                return { full, mtime: stat.mtimeMs };
            }).sort((a, b) => b.mtime - a.mtime);
            const latest = withTimes[0].full;
            const snapshot = loadSnapshotFromFile(latest);
            const filtered = hoistMiningInPaths(filterPathsByWorldSnapshot(aggregated, snapshot as any));
            logger.info(`\nFiltered by world snapshot (${path.basename(latest)}), count=${filtered.length}:`);
            let n = 0;
            for (const p of filtered.slice(0, pathsToLog)) {
                process.stdout.write(`#${++n} `);
                (plan as any)._internals.logActionPath(p);
            }

            const filteredDirect = await generateTopNAndFilter('1.20.1', item, count, { 
                inventory, 
                worldSnapshot: snapshot as any, 
                perGenerator, 
                log: false, 
                pruneWithWorld: getPruneWithWorldEnabled(),
                combineSimilarNodes
            });
            logger.info(`\nOne-shot generate+filter count=${filteredDirect.length}`);
            
            // Log first few paths
            let n2 = 0;
            for (const p of filteredDirect.slice(0, pathsToLog)) {
                process.stdout.write(`#${++n2} `);
                (plan as any)._internals.logActionPath(p);
            }
        } else {
            logger.info(`\nNo world snapshot files found in ${snapshotsDir}`);
        }
    } catch (err: any) {
        logger.error('World filtering demo error:', err && err.stack ? err.stack : err);
    }
})().catch(() => {});
