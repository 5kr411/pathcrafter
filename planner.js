const { setLastMcData, setWoodSpeciesTokens, setCurrentSpeciesContext, setTargetItemNameGlobal, getWoodSpeciesTokens } = require('./utils/context')
const { chooseMinimalToolName } = require('./utils/items')
const { genericizeItemName } = require('./utils/wood')
const { getGenericWoodEnabled } = require('./utils/config')
const actionPathsGenerator = require('./path_generators/actionPathsGenerator')
const shortestPathsGenerator = require('./path_generators/shortestPathsGenerator')
const lowestWeightPathsGenerator = require('./path_generators/lowestWeightPathsGenerator')
const pathUtils = require('./utils/pathUtils')
const { renderName } = require('./utils/render')
const treeBuild = require('./action_tree/build')
const treeLogger = require('./action_tree/logger')
const treeEnumerate = require('./action_tree/enumerate')
const treeMetrics = require('./action_tree/metrics')

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
    const effectiveItemName = getGenericWoodEnabled() ? itemName : itemName;
    // Optional world-pruning: derive world budget from snapshot summary
    let worldBudget = null;
    try {
        if (options && options.pruneWithWorld === true && options.worldSnapshot && typeof options.worldSnapshot === 'object') {
            const snap = options.worldSnapshot;
            const blocks = {};
            const entities = {};
            if (snap.blocks && typeof snap.blocks === 'object' && !Array.isArray(snap.blocks)) {
                for (const name of Object.keys(snap.blocks)) {
                    const rec = snap.blocks[name];
                    const c = rec && Number.isFinite(rec.count) ? rec.count : 0;
                    if (c > 0) blocks[name] = c;
                }
            }
            if (snap.entities && typeof snap.entities === 'object' && !Array.isArray(snap.entities)) {
                for (const name of Object.keys(snap.entities)) {
                    const rec = snap.entities[name];
                    const c = rec && Number.isFinite(rec.count) ? rec.count : 0;
                    if (c > 0) entities[name] = c;
                }
            }
            worldBudget = { blocks, entities };
        }
    } catch (_) {}
    const tree = treeBuild.buildRecipeTree(mc, effectiveItemName, targetCount, { inventory: options && options.inventory ? options.inventory : undefined, worldBudget });
    if (!options || options.log !== false) treeLogger.logActionTree(tree);
    return tree;
}

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
    logActionTree: treeLogger.logActionTree,
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


