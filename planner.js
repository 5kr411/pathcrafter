const { setLastMcData, setTargetItemNameGlobal } = require('./utils/context')
const { chooseMinimalToolName } = require('./utils/items')
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
    // Optional world-pruning: derive world budget from snapshot summary
    let worldBudget = null;
    try {
        if (options && options.pruneWithWorld === true && options.worldSnapshot && typeof options.worldSnapshot === 'object') {
            const snap = options.worldSnapshot;
            const blocks = {};
            const blocksInfo = {};
            const entities = {};
            const entitiesInfo = {};
            const distanceThreshold = Number.isFinite(snap.radius)
                ? snap.radius
                : (Number.isFinite(snap.maxDistance)
                    ? snap.maxDistance
                    : (Number.isFinite(snap.chunkRadius) ? ((snap.chunkRadius * 16) + 15) : Infinity));
            const allowedBlocksWithinThreshold = new Set();
            if (snap.blocks && typeof snap.blocks === 'object' && !Array.isArray(snap.blocks)) {
                for (const name of Object.keys(snap.blocks)) {
                    const rec = snap.blocks[name];
                    const c = rec && Number.isFinite(rec.count) ? rec.count : 0;
                    const d = rec && Number.isFinite(rec.closestDistance) ? rec.closestDistance : Infinity;
                    blocksInfo[name] = { closestDistance: d };
                    if (c > 0) blocks[name] = c;
                    if (d <= distanceThreshold) allowedBlocksWithinThreshold.add(name);
                }
            }
            const allowedEntitiesWithinThreshold = new Set();
            if (snap.entities && typeof snap.entities === 'object' && !Array.isArray(snap.entities)) {
                for (const name of Object.keys(snap.entities)) {
                    const rec = snap.entities[name];
                    const c = rec && Number.isFinite(rec.count) ? rec.count : 0;
                    const d = rec && Number.isFinite(rec.closestDistance) ? rec.closestDistance : Infinity;
                    entitiesInfo[name] = { closestDistance: d };
                    if (c > 0) entities[name] = c;
                    if (d <= distanceThreshold) allowedEntitiesWithinThreshold.add(name);
                }
            }
            worldBudget = { blocks, blocksInfo, entities, entitiesInfo, distanceThreshold, allowedBlocksWithinThreshold, allowedEntitiesWithinThreshold };
        }
    } catch (_) {}
    const tree = treeBuild.buildRecipeTree(mc, itemName, targetCount, { inventory: options && options.inventory ? options.inventory : undefined, worldBudget, config: options && options.config ? options.config : undefined });
    if (!options || options.log !== false) treeLogger.logActionTree(tree);
    return tree;
}

plan._internals = {
    resolveMcData: treeBuild.resolveMcData,
    requiresCraftingTable: treeBuild.requiresCraftingTable,
    renderName,
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


