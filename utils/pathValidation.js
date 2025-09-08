const { getLastMcData, getWoodSpeciesTokens } = require('./context');
const { getSuffixTokenFromName } = require('./items');
const { baseHasMultipleWoodSpecies } = require('./wood');

function isPathValidBasic(path, initialSupply, getSmeltsPerUnitForFuel) {
    const supply = new Map(initialSupply);
    function add(name, count) { if (!name || count <= 0) return; supply.set(name, (supply.get(name) || 0) + count); }
    function take(name, count) { if (!name || count <= 0) return true; const cur = supply.get(name) || 0; if (cur < count) return false; supply.set(name, cur - count); return true; }
    function produced(step) { return step && (step.targetItem || step.what); }
    for (const st of path) {
        if (!st) continue;
        if (st.action === 'mine' || st.action === 'hunt') { const prod = produced(st); add(prod, st.count || 1); continue; }
        if (st.action === 'craft') {
            if (Array.isArray(st.ingredients)) {
                for (const ing of st.ingredients) { const need = (ing?.perCraftCount || 0) * (st.count || 1); if (!take(ing?.item, need)) return false; }
            }
            const resCount = (st.result?.perCraftCount || 1) * (st.count || 1); add(st.result?.item, resCount); continue;
        }
        if (st.action === 'smelt') {
            const inCount = (st.input?.perSmelt || 1) * (st.count || 1); if (!take(st.input?.item, inCount)) return false;
            if (st.fuel) {
                try { const perFuel = getSmeltsPerUnitForFuel(st.fuel) || 0; const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1); if (!take(st.fuel, fuelNeed)) return false; }
                catch (_) { if (!take(st.fuel, 1)) return false; }
            }
            const outCount = (st.result?.perSmelt || 1) * (st.count || 1); add(st.result?.item, outCount); continue;
        }
    }
    return true;
}

function isPathValidWithFamilies(path, initialSupply, getSmeltsPerUnitForFuel) {
    const supply = new Map(initialSupply);
    function familyGenericKey(name) { if (!name) return null; const base = getSuffixTokenFromName(name); return baseHasMultipleWoodSpecies(base) ? `generic_${base}` : null; }
    function takeFromFamilySpecifics(base, count) {
        if (count <= 0) return 0;
        let remaining = count;
        const lastMcData = getLastMcData();
        const woodSpeciesTokens = getWoodSpeciesTokens();
        if (!woodSpeciesTokens) return 0;
        for (const species of woodSpeciesTokens) {
            if (remaining <= 0) break;
            const candidate = `${species}_${base}`;
            if (!lastMcData?.itemsByName?.[candidate]) continue;
            const cur = supply.get(candidate) || 0;
            if (cur <= 0) continue;
            const take = Math.min(cur, remaining);
            supply.set(candidate, cur - take);
            remaining -= take;
        }
        return count - remaining;
    }
    function add(name, count) { if (!name || count <= 0) return; supply.set(name, (supply.get(name) || 0) + count); }
    function take(name, count) {
        if (!name || count <= 0) return true;
        let cur = supply.get(name) || 0;
        if (cur >= count) { supply.set(name, cur - count); return true; }
        const fam = familyGenericKey(name); if (!fam) return false;
        let missing = count - cur; if (cur > 0) supply.set(name, 0);
        let gcur = supply.get(fam) || 0; if (gcur > 0) { const use = Math.min(gcur, missing); gcur -= use; supply.set(fam, gcur); missing -= use; }
        if (missing <= 0) return true;
        const base = getSuffixTokenFromName(name); const took = takeFromFamilySpecifics(base, missing);
        return took >= missing;
    }
    function produced(step) { return step && (step.targetItem || step.what); }
    for (const st of path) {
        if (!st) continue;
        if (st.action === 'mine' || st.action === 'hunt') { const prod = produced(st); add(prod, st.count || 1); continue; }
        if (st.action === 'craft') {
            if (Array.isArray(st.ingredients)) {
                for (const ing of st.ingredients) { const need = (ing?.perCraftCount || 0) * (st.count || 1); if (!take(ing?.item, need)) return false; }
            }
            const resCount = (st.result?.perCraftCount || 1) * (st.count || 1); add(st.result?.item, resCount); continue;
        }
        if (st.action === 'smelt') {
            const inCount = (st.input?.perSmelt || 1) * (st.count || 1); if (!take(st.input?.item, inCount)) return false;
            if (st.fuel) {
                try { const perFuel = getSmeltsPerUnitForFuel(st.fuel) || 0; const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1); if (!take(st.fuel, fuelNeed)) return false; }
                catch (_) { if (!take(st.fuel, 1)) return false; }
            }
            const outCount = (st.result?.perSmelt || 1) * (st.count || 1); add(st.result?.item, outCount); continue;
        }
    }
    return true;
}

module.exports = {
    isPathValidBasic,
    isPathValidWithFamilies
};


