const analyzeRecipes = require('./recipeAnalyzer');
const { resolveMcData } = analyzeRecipes._internals;

const mcData = resolveMcData('1.20.1');

const item = 'stone';
const count = 1;
const inventory = { crafting_table: 1, furnace: 1, wooden_pickaxe: 1, coal: 2, cobblestone: 1 };
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

// Test 2: crafting where all ingredients already exist (iron_block from 9 iron_ingot, table present)
const item2 = 'iron_block';
const count2 = 1;
const inventory2 = { crafting_table: 1, iron_ingot: 9 };
console.log(`\nAnalyzing target item: ${item2} x${count2}`);
console.log(`Using inventory: ${JSON.stringify(inventory2)}`);
const tree2 = analyzeRecipes(mcData, item2, count2, { log: false, inventory: inventory2 });
console.log(`\nGenerated action path tree with max depth: ${computeTreeMaxDepth(tree2)}`);
let pathsToLog2 = 10;
console.log(`\nFirst ${pathsToLog2} generated action paths for ${item2} x${count2}:`);
let j2 = 0;
for (const path of enumerateActionPathsGenerator(tree2, { inventory: inventory2 })) {
    process.stdout.write(`#${++j2} `);
    logActionPath(path);
    if (j2 >= pathsToLog2) break;
}
console.log(`\nFirst ${pathsToLog2} shortest action paths for ${item2} x${count2}:`);
let i2 = 0;
for (const path of enumerateShortestPathsGenerator(tree2, { inventory: inventory2 })) {
    process.stdout.write(`#${++i2} `);
    logActionPath(path);
    if (i2 >= pathsToLog2) break;
}
console.log(`\nTotal paths: ${countActionPaths(tree2)}`);

// bug with bamboo saplings? coming back as generic sapling and saying it drops sticks.
//
// having us obtain a crafting table multiple times for crafting cobblestone stairs, when in theory you can just re-use it.
//
// how do we trim paths to account for requirements already in inventory?
//
// weighting algorithm for paths?
