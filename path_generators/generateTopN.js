const plan = require('../planner');
const { computePathWeight } = require('../utils/pathUtils');
const { computePathResourceDemand } = require('../path_filters/worldResources');
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

async function generateTopNPathsFromGenerators(tree, options, perGenerator) {
    const inventory = options && options.inventory ? options.inventory : undefined;
    const snapshot = options && options.worldSnapshot ? options.worldSnapshot : null;

    const workerPath = path.resolve(__dirname, '../workers/enumerator_worker.js');
    const jobs = [
        { generator: 'action', tree, inventory, limit: perGenerator },
        { generator: 'shortest', tree, inventory, limit: perGenerator },
        { generator: 'lowest', tree, inventory, limit: perGenerator }
    ];

    let results = [];
    try {
        const batches = await Promise.all(jobs.map(job => new Promise((resolve) => {
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
        })));
        results = batches;
    } catch (_) {
        try {
            const a = []; const iterA = plan._internals.enumerateActionPathsGenerator(tree, { inventory });
            for (const p of takeN(iterA, perGenerator)) a.push(p);
            const b = []; const iterS = plan._internals.enumerateShortestPathsGenerator(tree, { inventory });
            for (const p of takeN(iterS, perGenerator)) b.push(p);
            const c = []; const iterL = plan._internals.enumerateLowestWeightPathsGenerator(tree, { inventory });
            for (const p of takeN(iterL, perGenerator)) c.push(p);
            results = [a, b, c];
        } catch (_) { results = [[], [], []]; }
    }

    const all = ([]).concat(...results);
    const unique = dedupePaths(all);

    function distanceScore(path) {
        try {
            if (!snapshot || !snapshot.blocks || typeof snapshot.blocks !== 'object') return Number.POSITIVE_INFINITY;
            const demand = computePathResourceDemand(path);
            let totalWeighted = 0;
            let totalCount = 0;
            if (demand && demand.blocks && demand.blocks.forEach) {
                demand.blocks.forEach((count, name) => {
                    const rec = snapshot.blocks[name];
                    const avg = rec && Number.isFinite(rec.averageDistance) ? rec.averageDistance : null;
                    if (avg != null) {
                        totalWeighted += avg * Math.max(1, count || 1);
                        totalCount += Math.max(1, count || 1);
                    }
                });
            }
            if (totalCount === 0) return Number.POSITIVE_INFINITY;
            return totalWeighted / totalCount;
        } catch (_) { return Number.POSITIVE_INFINITY; }
    }

    unique.sort((a, b) => {
        const wa = computePathWeight(a);
        const wb = computePathWeight(b);
        if (wa !== wb) return wa - wb;
        const da = distanceScore(a);
        const db = distanceScore(b);
        return da - db;
    });
    return unique;
}

module.exports = {
    takeN,
    serializePath,
    dedupePaths,
    generateTopNPathsFromGenerators
};


