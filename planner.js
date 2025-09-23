const { setLastMcData, setWoodSpeciesTokens, setCurrentSpeciesContext, setTargetItemNameGlobal, getWoodSpeciesTokens } = require('./utils/context')
const { chooseMinimalToolName } = require('./utils/items')
const { genericizeItemName } = require('./utils/wood')
const actionPathsGenerator = require('./path_generators/actionPathsGenerator')
const shortestPathsGenerator = require('./path_generators/shortestPathsGenerator')
const lowestWeightPathsGenerator = require('./path_generators/lowestWeightPathsGenerator')
const pathUtils = require('./utils/pathUtils')
const { renderName } = require('./utils/render')
const treeBuild = require('./dependency_tree/build')
const treeLogger = require('./dependency_tree/logger')
const treeEnumerate = require('./dependency_tree/enumerate')
const treeMetrics = require('./dependency_tree/metrics')

// (duplicate recipe logging moved to tree/logger)

function plan(ctx, itemName, targetCount = 1, options = {}) {
    const mc = treeBuild.resolveMcData(ctx);
    setLastMcData(mc);
    setTargetItemNameGlobal(itemName);
    let speciesTokens = getWoodSpeciesTokens();
    if (!speciesTokens) {
        speciesTokens = new Set();
        const names = Object.keys(mc.itemsByName || {});
        for (const n of names) {
            if (n.endsWith('_planks')) {
                const species = n.slice(0, -('_planks'.length));
                if (species.length > 0) speciesTokens.add(species);
            }
        }
        setWoodSpeciesTokens(speciesTokens);
    }
    let ctxSpecies = null;
    for (const species of speciesTokens) {
        if (itemName.startsWith(species + '_')) { ctxSpecies = species; break; }
    }
    setCurrentSpeciesContext(ctxSpecies);
    const tree = treeBuild.buildRecipeTree(mc, itemName, targetCount, { inventory: options && options.inventory ? options.inventory : undefined });
    if (!options || options.log !== false) treeLogger.logRecipeTree(tree);
    return tree;
}

// (action path logging moved to tree/logger)

plan._internals = {
    resolveMcData: treeBuild.resolveMcData,
    requiresCraftingTable: treeBuild.requiresCraftingTable,
    renderName,
    genericizeItemName,
    chooseMinimalToolName,
    findBlocksThatDrop: treeBuild.findBlocksThatDrop,
    printMiningPath: treeLogger.printMiningPath,
    getIngredientCounts: treeBuild.getIngredientCounts,
    hasCircularDependency: treeBuild.hasCircularDependency,
    printRecipeConversion: treeLogger.printRecipeConversion,
    findMobsThatDrop: treeBuild.findMobsThatDrop,
    printHuntingPath: treeLogger.printHuntingPath,
    buildRecipeTree: treeBuild.buildRecipeTree,
    logRecipeTree: treeLogger.logRecipeTree,
    enumerateActionPaths: treeEnumerate.enumerateActionPaths,
    enumerateShortestPathsGenerator: shortestPathsGenerator.enumerateShortestPathsGenerator,
    enumerateActionPathsGenerator: actionPathsGenerator.enumerateActionPathsGenerator,
    computeTreeMaxDepth: treeMetrics.computeTreeMaxDepth,
    countActionPaths: treeMetrics.countActionPaths,
    logActionPath: treeLogger.logActionPath,
    logActionPaths: treeLogger.logActionPaths,
    computePathWeight: pathUtils.computePathWeight,
    enumerateLowestWeightPathsGenerator: lowestWeightPathsGenerator.enumerateLowestWeightPathsGenerator
};

module.exports = plan;


