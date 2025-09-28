const { buildWorldAvailability, computePathResourceDemand, isDemandSatisfiedByAvailability } = require('./worldResources');

function filterPathsByWorldSnapshot(paths, snapshot, options = {}) {
    const availability = buildWorldAvailability(snapshot);
    const results = [];
    for (const path of paths) {
        const demand = computePathResourceDemand(path);
        if (isDemandSatisfiedByAvailability(demand, availability, options)) {
            results.push(path);
        }
    }
    return results;
}

module.exports = { filterPathsByWorldSnapshot };


