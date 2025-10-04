import analyzeRecipes from './recipeAnalyzer';
import logger from './utils/logger';

const { resolveMcData } = (analyzeRecipes as any)._internals;

const mcData = resolveMcData('1.20.1');

const item = 'cobblestone';
const count = 1;
const inventory = { stone_pickaxe: 1 };
logger.info(`Analyzing target item: ${item} x${count}`);
logger.info(`Using inventory: ${JSON.stringify(inventory)}`);
const tree = analyzeRecipes(mcData, item, count, { log: false, inventory });

const { enumerateActionPathsGenerator, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, logActionPath, computeTreeMaxDepth, countActionPaths } = (analyzeRecipes as any)._internals;
logger.info(`\nGenerated action path tree with max depth: ${computeTreeMaxDepth(tree)}`);
let pathsToLog = 10;
logger.info(`\nFirst ${pathsToLog} generated action paths for ${item} x${count}:`);
let i = 0;
for (const path of enumerateActionPathsGenerator(tree, { inventory })) {
    process.stdout.write(`#${++i} `);
    logActionPath(path);
    if (i >= pathsToLog) break;
}
logger.info(`\nFirst ${pathsToLog} shortest action paths for ${item} x${count}:`);
let j = 0;
for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
    process.stdout.write(`#${++j} `);
    logActionPath(path);
    if (j >= pathsToLog) break;
}

logger.info(`\nFirst ${pathsToLog} lowest-weight action paths for ${item} x${count}:`);
let k = 0;
for (const path of enumerateLowestWeightPathsGenerator(tree, { inventory })) {
    process.stdout.write(`#${++k} `);
    logActionPath(path);
    if (k >= pathsToLog) break;
}

logger.info(`\nTotal paths: ${countActionPaths(tree)}`);

// bug with bamboo saplings? coming back as generic sapling and saying it drops sticks.
//
// unit tests of current functionality to make sure we don't break when refactoring?
//
// test dependency detection and deduping
// test not trying to craft iron ingot out of nuggest from thin air (from circular dependency break)
//
// refactoring the code to make it more readable?
// combining path requirements where possible?
// add together the gathering requirements for each path?
// prune paths where the gathering requirements are not possible based on world data?
