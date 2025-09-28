function makeMiningKey(step) {
    const what = step && step.what ? String(step.what) : null;
    const target = step && step.targetItem ? String(step.targetItem) : null;
    const tool = step && step.tool ? String(step.tool) : null;
    return JSON.stringify({ what, target, tool });
}

function hoistMiningInPath(path) {
    if (!Array.isArray(path)) return path;
    const firstIndexByKey = new Map();
    const totalCountByKey = new Map();
    const indicesToRemove = new Set();

    for (let i = 0; i < path.length; i++) {
        const step = path[i];
        if (!step || step.action !== 'mine') continue;
        const key = makeMiningKey(step);
        const count = Number(step.count) || 1;
        if (!firstIndexByKey.has(key)) {
            firstIndexByKey.set(key, i);
            totalCountByKey.set(key, count);
        } else {
            totalCountByKey.set(key, (totalCountByKey.get(key) || 0) + count);
            indicesToRemove.add(i);
        }
    }

    if (indicesToRemove.size === 0) return path;

    const optimized = [];
    for (let i = 0; i < path.length; i++) {
        if (indicesToRemove.has(i)) continue;
        const step = path[i];
        if (step && step.action === 'mine') {
            const key = makeMiningKey(step);
            const firstIdx = firstIndexByKey.get(key);
            if (firstIdx === i) {
                const total = totalCountByKey.get(key) || (Number(step.count) || 1);
                if ((Number(step.count) || 1) !== total) {
                    optimized.push({ ...step, count: total });
                    continue;
                }
            }
        }
        optimized.push(step);
    }
    return optimized;
}

function hoistMiningInPaths(paths) {
    if (!Array.isArray(paths)) return paths;
    return paths.map(p => hoistMiningInPath(p));
}

module.exports = {
    hoistMiningInPath,
    hoistMiningInPaths
};


