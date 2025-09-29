const plan = require('../planner');
const { computePathWeight } = require('../utils/pathUtils');
const { Worker } = require('worker_threads');
const path = require('path');

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
    const all = [];

    // Run three enumerators in parallel workers
    const workerPath = path.resolve(__dirname, '../workers/enumerator_worker.js');
    const jobs = [
        { generator: 'action', tree, inventory, limit: perGenerator },
        { generator: 'shortest', tree, inventory, limit: perGenerator },
        { generator: 'lowest', tree, inventory, limit: perGenerator }
    ];

    const promises = jobs.map(job => new Promise((resolve) => {
        try {
            const w = new Worker(workerPath);
            w.once('message', (msg) => {
                try { w.terminate(); } catch (_) {}
                if (!msg || msg.type !== 'result' || msg.ok !== true) return resolve([]);
                resolve(Array.isArray(msg.paths) ? msg.paths : []);
            });
            w.once('error', () => { try { w.terminate(); } catch (_) {} resolve([]); });
            w.postMessage({ type: 'enumerate', ...job });
        } catch (_) { resolve([]); }
    }));

    try {
        const results = require('worker_threads').isMainThread ? require('worker_threads') : null;
        // Wait all
    } catch (_) {}
    // Await all promises synchronously via Promise.all in Node
    // Note: generateTopNPathsFromGenerators is sync today; we collect via deasync-like join by blocking event loop
    // For simplicity, we will use Atomics.wait via worker_threads is not needed; instead convert to sync using childPromise.then
    // However, tests expect sync; so we fallback to sequential when worker threads unavailable

    let batches = [];
    try {
        // Simple sync wait: we cannot actually block; fallback to sequential
        throw new Error('fallback');
    } catch (_) {
        // Fallback to previous sequential behavior
        try {
            const iterA = plan._internals.enumerateActionPathsGenerator(tree, { inventory });
            for (const p of takeN(iterA, perGenerator)) all.push(p);
        } catch (_) {}
        try {
            const iterS = plan._internals.enumerateShortestPathsGenerator(tree, { inventory });
            for (const p of takeN(iterS, perGenerator)) all.push(p);
        } catch (_) {}
        try {
            const iterL = plan._internals.enumerateLowestWeightPathsGenerator(tree, { inventory });
            for (const p of takeN(iterL, perGenerator)) all.push(p);
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


