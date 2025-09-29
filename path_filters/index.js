const { buildWorldAvailability, computePathResourceDemand, isDemandSatisfiedByAvailability } = require('./worldResources');
const { filterPathsByWorldSnapshot } = require('./filterByWorld');
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
    const candidates = generateTopNPathsFromGenerators(tree, options, perGenerator);
    if (!snapshot) {
        return hoistMiningInPaths(candidates);
    }
    const cfgEnabled = options && options.config && typeof options.config.genericWoodEnabled === 'boolean' ? options.config.genericWoodEnabled : undefined;
    const effectiveEnabled = (typeof cfgEnabled === 'boolean') ? cfgEnabled : getGenericWoodEnabled();
    const disableGenericWood = options.disableGenericWood === true ? true : !effectiveEnabled;
    const filtered = filterPathsByWorldSnapshot(candidates, snapshot, { disableGenericWood });
    return hoistMiningInPaths(filtered);
}

module.exports = {
    buildWorldAvailability,
    computePathResourceDemand,
    isDemandSatisfiedByAvailability,
    filterPathsByWorldSnapshot,
    generateTopNAndFilter
};


