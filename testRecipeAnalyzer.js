const analyzeRecipes = require('./recipeAnalyzer');
const { resolveMcData } = analyzeRecipes._internals;

const mcData = resolveMcData('1.20.1');

const item = 'stone';
const count = 1;
console.log(`Analyzing target item: ${item} x${count}`);
const tree = analyzeRecipes(mcData, item, count, { log: false });

const { enumerateActionPathsGenerator, enumerateShortestPathsGenerator, logActionPath, computeTreeMaxDepth, countActionPaths } = analyzeRecipes._internals;
console.log(`\nGenerated action path tree with max depth: ${computeTreeMaxDepth(tree)}`);
let pathsToLog = 20;
console.log(`\nFirst ${pathsToLog} generated action paths for ${item} x${count}:`);
let j = 0;
for (const path of enumerateActionPathsGenerator(tree)) {
    process.stdout.write(`#${++j} `);
    logActionPath(path);
    if (j >= pathsToLog) break;
}
console.log(`\nFirst ${pathsToLog} shortest action paths for ${item} x${count}:`);
let i = 0;
for (const path of enumerateShortestPathsGenerator(tree)) {
    process.stdout.write(`#${++i} `);
    logActionPath(path);
    if (i >= pathsToLog) break;
}
console.log(`\nTotal paths: ${countActionPaths(tree)}`);

// bug with bamboo saplings? coming back as generic sapling and saying it drops sticks.
//
// having us obtain a crafting table multiple times for crafting cobblestone stairs, when in theory you can just re-use it.
//
// how do we trim paths to account for requirements already in inventory?
//
// weighting algorithm for paths?
