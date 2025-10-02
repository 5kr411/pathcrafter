function canConsumeWorld(worldBudget, kind, name, amount) {
    if (!worldBudget || amount <= 0) return true;
    const pool = worldBudget[kind]; if (!pool) return true;
    const have = pool[name] || 0;
    const allowSet = kind === 'blocks' ? worldBudget.allowedBlocksWithinThreshold : worldBudget.allowedEntitiesWithinThreshold;
    if (allowSet && allowSet.has && have > 0) {
        if (!allowSet.has(name)) return false;
    } else if (have > 0 && worldBudget && worldBudget[`${kind}Info`]) {
        const info = worldBudget[`${kind}Info`][name];
        const closest = info && Number.isFinite(info.closestDistance) ? info.closestDistance : Infinity;
        const thresh = Number.isFinite(worldBudget.distanceThreshold) ? worldBudget.distanceThreshold : Infinity;
        if (!(closest <= thresh)) return false;
    }
    return have >= amount;
}

function consumeWorld(worldBudget, kind, name, amount) {
    if (!worldBudget || amount <= 0) return;
    const pool = worldBudget[kind]; if (!pool) return;
    const have = pool[name] || 0; pool[name] = Math.max(0, have - amount);
}

function sumAvailable(worldBudget, kind, names) {
    if (!worldBudget) return Number.POSITIVE_INFINITY;
    const pool = worldBudget[kind]; if (!pool) return Number.POSITIVE_INFINITY;
    let sum = 0;
    for (const n of names) sum += pool[n] || 0;
    return sum;
}

function reserveFromSources(worldBudget, kind, names, amount) {
    if (!worldBudget || amount <= 0) return 0;
    const pool = worldBudget[kind]; if (!pool) return 0;
    const ordered = Array.from(new Set(names)).sort((a, b) => (pool[b] || 0) - (pool[a] || 0));
    let remaining = amount;
    for (const n of ordered) {
        if (remaining <= 0) break;
        const have = pool[n] || 0;
        if (have <= 0) continue;
        const take = Math.min(have, remaining);
        pool[n] = have - take;
        remaining -= take;
    }
    return amount - remaining;
}

module.exports = {
    canConsumeWorld,
    consumeWorld,
    sumAvailable,
    reserveFromSources,
    createWorldBudgetAccessors
};

function createWorldBudgetAccessors(worldBudget) {
    const memoCan = new Map();
    const memoSum = new Map();
    function can(kind, name, amount) {
        if (!worldBudget) return true;
        const key = `${kind}|${name}|${amount}`;
        if (memoCan.has(key)) return memoCan.get(key);
        const ok = canConsumeWorld(worldBudget, kind, name, amount);
        memoCan.set(key, ok);
        return ok;
    }
    function sum(kind, names) {
        if (!worldBudget) return Number.POSITIVE_INFINITY;
        const uniq = Array.from(new Set(names)).sort();
        const key = `${kind}|${uniq.join(',')}`;
        if (memoSum.has(key)) return memoSum.get(key);
        const s = sumAvailable(worldBudget, kind, uniq);
        memoSum.set(key, s);
        return s;
    }
    function reserve(kind, names, amount) {
        return reserveFromSources(worldBudget, kind, names, amount);
    }
    return { can, sum, reserve };
}




