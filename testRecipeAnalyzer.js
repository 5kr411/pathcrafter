const analyzeRecipes = require('./recipeAnalyzer');
const { resolveMcData } = analyzeRecipes._internals;

const mcData = resolveMcData('1.20.1');

const item = 'wooden_pickaxe';
const count = 1;
const inventory = { crafting_table: 1, oak_planks: 3 };
console.log(`Analyzing target item: ${item} x${count}`);
console.log(`Using inventory: ${JSON.stringify(inventory)}`);
const tree = analyzeRecipes(mcData, item, count, { log: false, inventory });

const { enumerateActionPathsGenerator, enumerateShortestPathsGenerator, logActionPath, computeTreeMaxDepth, countActionPaths } = analyzeRecipes._internals;
console.log(`\nGenerated action path tree with max depth: ${computeTreeMaxDepth(tree)}`);
let pathsToLog = 10;
console.log(`\nFirst ${pathsToLog} generated action paths for ${item} x${count}:`);
let j = 0;
for (const path of enumerateActionPathsGenerator(tree, { inventory })) {
    process.stdout.write(`#${++j} `);
    logActionPath(path);
    if (j >= pathsToLog) break;
}
console.log(`\nFirst ${pathsToLog} shortest action paths for ${item} x${count}:`);
let i = 0;
for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
    process.stdout.write(`#${++i} `);
    logActionPath(path);
    if (i >= pathsToLog) break;
}
console.log(`\nTotal paths: ${countActionPaths(tree)}`);

// bug with bamboo saplings? coming back as generic sapling and saying it drops sticks.
//
// weighting algorithm for paths?
