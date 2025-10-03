const plan = require('./planner');
const { resolveMcData } = plan._internals;
const { setGenericWoodEnabled, getGenericWoodEnabled } = require('./utils/config');
const fs = require('fs');
const path = require('path');
const { filterPathsByWorldSnapshot, generateTopNAndFilter } = require('./path_filters');
const { getDefaultPerGeneratorPaths, getPruneWithWorldEnabled } = require('./utils/config');
const { hoistMiningInPaths } = require('./path_optimizations/hoistMining');
const { loadSnapshotFromFile } = require('./utils/worldSnapshot');
const { generateTopNPathsFromGenerators } = require('./path_generators/generateTopN');
const logger = require('utils/logger')

// Project-wide config for this demo run
const mcData = resolveMcData('1.20.1');
const plannerConfig = { genericWoodEnabled: true };
setGenericWoodEnabled(plannerConfig.genericWoodEnabled);

const item = 'wooden_pickaxe';
const count = 1;
const inventory = { /*cobblestone: 2, stick: 2, crafting_table: 1 */ };
logger.info(`Analyzing target item: ${item} x${count}`);
logger.info(`\nUsing inventory: ${JSON.stringify(inventory)}`);
const tree = plan(mcData, item, count, { log: false, inventory });

logger.info(`\nConfig: { genericWoodEnabled: ${getGenericWoodEnabled()} }`);

// demo logging disabled

const { enumerateActionPathsGenerator, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, logActionPath, computeTreeMaxDepth, countActionPaths } = plan._internals;
logger.info(`\nGenerated action tree with max depth: ${computeTreeMaxDepth(tree)}`);

logger.info(`\nTotal paths: ${countActionPaths(tree)}`);

let pathsToLog = 10;

// listing disabled

// listing disabled

// listing disabled

const perGenerator = getDefaultPerGeneratorPaths();
;(async () => {
const aggregatedRaw = await generateTopNPathsFromGenerators(tree, { inventory }, perGenerator);
const aggregated = hoistMiningInPaths(aggregatedRaw);

// listing disabled

// World filtering demo using snapshot from world-snapshots directory
try {
    const snapshotsDir = path.resolve(__dirname, 'world_snapshots');
    const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json'));
    if (files.length > 0) {
        const withTimes = files.map(f => {
            const full = path.join(snapshotsDir, f);
            const stat = fs.statSync(full);
            return { full, mtime: stat.mtimeMs };
        }).sort((a, b) => b.mtime - a.mtime);
        const latest = withTimes[0].full;
        const snapshot = loadSnapshotFromFile(latest);
        const filtered = hoistMiningInPaths(filterPathsByWorldSnapshot(aggregated, snapshot, { disableGenericWood: !plannerConfig.genericWoodEnabled }));
        logger.info(`\nFiltered by world snapshot (${path.basename(latest)}), count=${filtered.length}:`);
        let n = 0;
        for (const p of filtered.slice(0, pathsToLog)) {
            process.stdout.write(`#${++n} `);
            plan._internals.logActionPath(p);
        }

        const filteredDirect = await generateTopNAndFilter('1.20.1', item, count, { inventory, worldSnapshot: snapshot, perGenerator, log: false, config: plannerConfig, pruneWithWorld: getPruneWithWorldEnabled() });
        logger.info(`\nOne-shot generate+filter count=${filteredDirect.length}`);
    } else {
        logger.info(`\nNo world snapshot files found in ${snapshotsDir}`);
    }
} catch (err) {
    logger.error('World filtering demo error:', err && err.stack ? err.stack : err);
}
})().catch(() => {})



