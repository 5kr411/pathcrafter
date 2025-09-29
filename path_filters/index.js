const { buildWorldAvailability, computePathResourceDemand, isDemandSatisfiedByAvailability } = require('./worldResources');
const { hoistMiningInPaths } = require('../path_optimizations/hoistMining');
const { generateTopNPathsFromGenerators } = require('../path_generators/generateTopN');
const plan = require('../planner');
const { getGenericWoodEnabled, getPruneWithWorldEnabled, getDefaultPerGeneratorPaths } = require('../utils/config');

function generateTopNAndFilter(ctx, itemName, targetCount, options = {}) {
    const perGenerator = Number.isFinite(options.perGenerator) ? options.perGenerator : getDefaultPerGeneratorPaths();
    const snapshot = options.worldSnapshot;
    const mcData = plan._internals.resolveMcData(ctx);
    const pruneWithWorld = options.pruneWithWorld === true ? true : getPruneWithWorldEnabled();
    const tree = plan(mcData, itemName, targetCount, { inventory: options.inventory, log: options.log, pruneWithWorld, worldSnapshot: snapshot });
    const candidates = generateTopNPathsFromGenerators(tree, { ...options, worldSnapshot: snapshot }, perGenerator);
    return hoistMiningInPaths(candidates);
}

module.exports = {
    buildWorldAvailability,
    computePathResourceDemand,
    isDemandSatisfiedByAvailability,
    generateTopNAndFilter
};


