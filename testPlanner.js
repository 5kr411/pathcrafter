const plan = require('./planner');
const { resolveMcData } = plan._internals;
const { setGenericWoodEnabled, getGenericWoodEnabled } = require('./utils/config');
const fs = require('fs');
const path = require('path');
const { filterPathsByWorldSnapshot, generateTopNAndFilter } = require('./path_filters');
const { loadSnapshotFromFile } = require('./utils/worldSnapshot');
const { generateTopNPathsFromGenerators } = require('./path_generators/generateTopN');

// Project-wide config for this demo run
const mcData = resolveMcData('1.20.1');
const plannerConfig = { genericWoodEnabled: false };
setGenericWoodEnabled(plannerConfig.genericWoodEnabled);

const item = 'crafting_table';
const count = 1;
const inventory = { /*cobblestone: 2, stick: 2, crafting_table: 1 */ };
console.log(`Analyzing target item: ${item} x${count}`);
console.log(`\nUsing inventory: ${JSON.stringify(inventory)}`);
const tree = plan(mcData, item, count, { log: false, inventory });

// console.log(`\nAction tree:`);
// plan._internals.logActionTree(tree);

const { enumerateActionPathsGenerator, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, logActionPath, computeTreeMaxDepth, countActionPaths } = plan._internals;
console.log(`\nGenerated action tree with max depth: ${computeTreeMaxDepth(tree)}`);

console.log(`\nTotal paths: ${countActionPaths(tree)}`);
console.log(`\nConfig: { genericWoodEnabled: ${getGenericWoodEnabled()} }`);

let pathsToLog = 10;

// console.log(`\nFirst ${pathsToLog} generated action paths for ${item} x${count}:`);
// let i = 0;
// for (const path of enumerateActionPathsGenerator(tree, { inventory })) {
//     process.stdout.write(`#${++i} `);
//     logActionPath(path);
//     if (i >= pathsToLog) break;
// }

// console.log(`\nFirst ${pathsToLog} shortest action paths for ${item} x${count}:`);
// let j = 0;
// for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
//     process.stdout.write(`#${++j} `);
//     logActionPath(path);
//     if (j >= pathsToLog) break;
// }

// console.log(`\nFirst ${pathsToLog} lowest-weight action paths for ${item} x${count}:`);
// let k = 0;
// for (const path of enumerateLowestWeightPathsGenerator(tree, { inventory })) {
//     process.stdout.write(`#${++k} `);
//     logActionPath(path);
//     if (k >= pathsToLog) break;
// }

const perGenerator = 20;
const aggregated = generateTopNPathsFromGenerators(tree, { inventory }, perGenerator);
console.log(`\nAggregated top ${perGenerator} per generator (deduped and weight-ordered), count=${aggregated.length}:`);
let m = 0;
for (const p of aggregated.slice(0, pathsToLog)) {
    process.stdout.write(`#${++m} `);
    plan._internals.logActionPath(p);
}

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
        const filtered = filterPathsByWorldSnapshot(aggregated, snapshot, { disableGenericWood: !plannerConfig.genericWoodEnabled });
        console.log(`\nFiltered by world snapshot (${path.basename(latest)}), count=${filtered.length}:`);
        let n = 0;
        for (const p of filtered.slice(0, pathsToLog)) {
            process.stdout.write(`#${++n} `);
            plan._internals.logActionPath(p);
        }

        const filteredDirect = generateTopNAndFilter('1.20.1', item, count, { inventory, worldSnapshot: snapshot, perGenerator, log: false, config: plannerConfig });
        console.log(`\nOne-shot generate+filter count=${filteredDirect.length}`);
    } else {
        console.log(`\nNo world snapshot files found in ${snapshotsDir}`);
    }
} catch (err) {
    console.error('World filtering demo error:', err && err.stack ? err.stack : err);
}



