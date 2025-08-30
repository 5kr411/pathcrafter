const analyzeRecipes = require('./recipeAnalyzer');
const { resolveMcData } = analyzeRecipes._internals;

const mcData = resolveMcData('1.20.1');

const item = 'cobblestone';
const count = 1;
console.log(`Analyzing target: ${item} x${count}`);
const tree = analyzeRecipes(mcData, item, count, { log: false });

const { enumerateActionPathsGenerator, logActionPath, computeTreeMaxDepth, countActionPaths } = analyzeRecipes._internals;
console.log(`\nGenerated action path tree with max depth: ${computeTreeMaxDepth(tree)}`);
let pathsToLog = 10;
console.log(`\nFirst ${pathsToLog} enumerated action paths for ${item} x${count}:`);
let i = 0;
for (const path of enumerateActionPathsGenerator(tree)) {
    process.stdout.write(`#${++i} `);
    logActionPath(path);
    if (i >= pathsToLog) break;
}
console.log(`\nTotal paths: ${countActionPaths(tree)}`);
