const plan = require('../planner');
const { computePathWeight } = require('../utils/pathUtils');

function* takeN(iter, n) {
    let i = 0;
    for (const v of iter) {
        yield v;
        i += 1;
        if (i >= n) break;
    }
}

function serializePath(path) {
    try { return JSON.stringify(path); } catch (_) { return String(Math.random()); }
}

function dedupePaths(paths) {
    const seen = new Set();
    const out = [];
    for (const p of paths) {
        const key = serializePath(p);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
    }
    return out;
}

function generateTopNPathsFromGenerators(tree, options, perGenerator) {
    const inventory = options && options.inventory ? options.inventory : undefined;
    const gens = [
        plan._internals.enumerateActionPathsGenerator,
        plan._internals.enumerateShortestPathsGenerator,
        plan._internals.enumerateLowestWeightPathsGenerator
    ];
    const all = [];
    for (const g of gens) {
        try {
            const iter = g(tree, { inventory });
            for (const p of takeN(iter, perGenerator)) all.push(p);
        } catch (_) {}
    }
    const unique = dedupePaths(all);
    unique.sort((a, b) => computePathWeight(a) - computePathWeight(b));
    return unique;
}

module.exports = {
    takeN,
    serializePath,
    dedupePaths,
    generateTopNPathsFromGenerators
};


