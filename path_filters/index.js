const { buildWorldAvailability, computePathResourceDemand, isDemandSatisfiedByAvailability } = require('./worldResources');
const { filterPathsByWorldSnapshot } = require('./filterByWorld');
const { generateTopNPathsFromGenerators } = require('../path_generators/generateTopN');
const plan = require('../planner');

function generateTopNAndFilter(ctx, itemName, targetCount, options = {}) {
    const perGenerator = Number.isFinite(options.perGenerator) ? options.perGenerator : 50;
    const snapshot = options.worldSnapshot;
    const mcData = plan._internals.resolveMcData(ctx);
    const tree = plan(mcData, itemName, targetCount, { inventory: options.inventory, log: options.log });
    const candidates = generateTopNPathsFromGenerators(tree, options, perGenerator);
    if (!snapshot) return candidates;
    return filterPathsByWorldSnapshot(candidates, snapshot);
}

module.exports = {
    buildWorldAvailability,
    computePathResourceDemand,
    isDemandSatisfiedByAvailability,
    filterPathsByWorldSnapshot,
    generateTopNAndFilter
};


