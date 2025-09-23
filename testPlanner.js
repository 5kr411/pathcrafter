const plan = require('./planner');
const { resolveMcData } = plan._internals;

const mcData = resolveMcData('1.20.1');

const item = 'cobblestone';
const count = 1;
const inventory = { stone_pickaxe: 1 };
console.log(`Analyzing target item: ${item} x${count}`);
console.log(`Using inventory: ${JSON.stringify(inventory)}`);
const tree = plan(mcData, item, count, { log: false, inventory });

const { enumerateActionPathsGenerator, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, logActionPath, computeTreeMaxDepth, countActionPaths } = plan._internals;
console.log(`\nGenerated action path tree with max depth: ${computeTreeMaxDepth(tree)}`);
let pathsToLog = 10;
console.log(`\nFirst ${pathsToLog} generated action paths for ${item} x${count}:`);
let i = 0;
for (const path of enumerateActionPathsGenerator(tree, { inventory })) {
    process.stdout.write(`#${++i} `);
    logActionPath(path);
    if (i >= pathsToLog) break;
}
console.log(`\nFirst ${pathsToLog} shortest action paths for ${item} x${count}:`);
let j = 0;
for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
    process.stdout.write(`#${++j} `);
    logActionPath(path);
    if (j >= pathsToLog) break;
}

console.log(`\nFirst ${pathsToLog} lowest-weight action paths for ${item} x${count}:`);
let k = 0;
for (const path of enumerateLowestWeightPathsGenerator(tree, { inventory })) {
    process.stdout.write(`#${++k} `);
    logActionPath(path);
    if (k >= pathsToLog) break;
}

console.log(`\nTotal paths: ${countActionPaths(tree)}`);



