function dedupePersistentAcquisitions(path, isPersistentName) {
    const have = new Map();
    const keepForward = new Array(path.length).fill(true);
    function produced(step) {
        if (!step) return null;
        if (step.action === 'craft' && step.result && step.result.item) return step.result.item;
        if (step.action === 'smelt' && step.result && step.result.item) return step.result.item;
        if ((step.action === 'mine' || step.action === 'hunt') && (step.targetItem || step.what)) return (step.targetItem || step.what);
        return null;
    }
    function addHave(name) { if (!name) return; have.set(name, (have.get(name) || 0) + 1); }
    function hasHave(name) { return have.has(name) && have.get(name) > 0; }
    for (let i = 0; i < path.length; i++) {
        const st = path[i];
        const prod = produced(st);
        if (prod && isPersistentName(prod)) {
            if (hasHave(prod)) { keepForward[i] = false; continue; }
            addHave(prod);
        }
    }
    return path.filter((_, idx) => keepForward[idx]);
}

function sanitizePath(path, opts) {
    const isPersistentName = opts && typeof opts.isPersistentName === 'function' ? opts.isPersistentName : () => false;
    const isPathValid = opts && typeof opts.isPathValid === 'function' ? opts.isPathValid : null;
    const getSmeltsPerUnitForFuel = opts && typeof opts.getSmeltsPerUnitForFuel === 'function' ? opts.getSmeltsPerUnitForFuel : null;

    const filtered = dedupePersistentAcquisitions(path, isPersistentName);

    const need = new Map();
    (function seedFinalDemand() {
        for (let i = filtered.length - 1; i >= 0; i--) {
            const st = filtered[i];
            if (!st) continue;
            if (st.action === 'craft') {
                const out = st.result && st.result.item;
                const outCount = (st.result && st.result.perCraftCount ? st.result.perCraftCount : 1) * (st.count || 1);
                if (out && outCount > 0) { need.set(out, (need.get(out) || 0) + outCount); break; }
            }
            if (st.action === 'smelt') {
                const out = st.result && st.result.item;
                const outCount = (st.result && st.result.perSmelt ? st.result.perSmelt : 1) * (st.count || 1);
                if (out && outCount > 0) { need.set(out, (need.get(out) || 0) + outCount); break; }
            }
            if (st.action === 'mine' || st.action === 'hunt') {
                const out = st.targetItem || st.what;
                const outCount = (st.count || 1);
                if (out && outCount > 0) { need.set(out, (need.get(out) || 0) + outCount); break; }
            }
        }
    })();
    const keep = new Array(filtered.length).fill(false);
    function incNeed(name, count) { if (!name || count <= 0) return; need.set(name, (need.get(name) || 0) + count); }
    function decNeed(name, count) { if (!name || count <= 0) return; const cur = need.get(name) || 0; const next = cur - count; if (next > 0) need.set(name, next); else need.delete(name); }
    for (let i = filtered.length - 1; i >= 0; i--) {
        const st = filtered[i];
        if (!st) continue;
        if (st.action === 'smelt') {
            keep[i] = true;
            // Smelting requires a furnace to be present; encode this as demand so its acquisition isn't dropped
            incNeed('furnace', 1);
            const inCount = (st.input && st.input.perSmelt ? st.input.perSmelt : 1) * (st.count || 1);
            incNeed(st.input && st.input.item, inCount);
            if (st.fuel) {
                if (getSmeltsPerUnitForFuel) {
                    try {
                        const perFuel = getSmeltsPerUnitForFuel(st.fuel) || 0;
                        const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1);
                        incNeed(st.fuel, fuelNeed);
                    } catch (_) { incNeed(st.fuel, 1); }
                } else {
                    incNeed(st.fuel, (st.count || 1));
                }
            }
            continue;
        }
        if (st.action === 'craft') {
            // If this craft uses the crafting table, require one to be present earlier in the path
            if (st.what === 'table') { incNeed('crafting_table', 1); }
            const out = st.result && st.result.item;
            const outCount = (st.result && st.result.perCraftCount ? st.result.perCraftCount : 1) * (st.count || 1);
            const demand = out ? (need.get(out) || 0) : 0;
            if (demand <= 0 && !(out && isPersistentName(out))) {
                keep[i] = false;
                continue;
            }
            keep[i] = true;
            if (Array.isArray(st.ingredients)) {
                for (const ing of st.ingredients) incNeed(ing && ing.item, (ing && ing.perCraftCount ? ing.perCraftCount : 0) * (st.count || 1));
            }
            if (out) decNeed(out, outCount);
            continue;
        }
        if (st.action === 'mine' || st.action === 'hunt') {
            const out = st.targetItem || st.what;
            const demand = need.get(out) || 0;
            if (demand > 0) {
                keep[i] = true;
                decNeed(out, st.count || 1);
                if (st.tool) incNeed(st.tool, 1);
            } else {
                keep[i] = false;
            }
            continue;
        }
        keep[i] = true;
    }
    const out = filtered.filter((_, idx) => keep[idx]);
    if (isPathValid) {
        try { if (!isPathValid(out)) return path; } catch (_) { return path; }
    }
    return out;
}

module.exports = {
    dedupePersistentAcquisitions,
    sanitizePath
};


