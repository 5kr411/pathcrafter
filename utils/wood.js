const { getLastMcData, getWoodSpeciesTokens, setWoodSpeciesTokens, getCurrentSpeciesContext, getTargetItemNameGlobal } = require('./context');
const { getGenericWoodEnabled } = require('./config');
const { getSuffixTokenFromName } = require('./items');

function extractSpeciesPrefix(name) {
    const woodSpeciesTokens = getWoodSpeciesTokens();
    if (!name || !name.includes('_') || !woodSpeciesTokens) return null;
    const idx = name.lastIndexOf('_');
    if (idx <= 0) return null;
    const prefix = name.slice(0, idx);
    let best = null;
    for (const s of woodSpeciesTokens) { if (prefix === s) { best = s; break; } }
    return best;
}

function baseHasMultipleWoodSpecies(baseName) {
    const lastMcData = getLastMcData();
    const woodSpeciesTokens = getWoodSpeciesTokens();
    if (!lastMcData || !woodSpeciesTokens || !baseName) return false;
    let count = 0;
    for (const species of woodSpeciesTokens) {
        const candidate = `${species}_${baseName}`;
        if (lastMcData.itemsByName[candidate]) { count++; if (count >= 2) return true; }
    }
    return false;
}

function genericizeItemName(name) {
    if (!getGenericWoodEnabled()) return name;
    const lastMcData = getLastMcData();
    if (!lastMcData) return name;
    const targetItemNameGlobal = getTargetItemNameGlobal();
    if (targetItemNameGlobal && name === targetItemNameGlobal) return name;
    if (!name || !name.includes('_')) return name;
    const currentSpeciesContext = getCurrentSpeciesContext();
    if (currentSpeciesContext && name.startsWith(currentSpeciesContext + '_')) return name;
    const base = getSuffixTokenFromName(name);
    let count = 0;
    const woodSpeciesTokens = getWoodSpeciesTokens();
    if (!woodSpeciesTokens) return name;
    for (const species of woodSpeciesTokens) {
        const candidate = `${species}_${base}`;
        if (lastMcData.itemsByName[candidate]) count++;
        if (count >= 2) break;
    }
    if (count >= 2) return `generic_${base}`;
    return name;
}

module.exports = {
    extractSpeciesPrefix,
    baseHasMultipleWoodSpecies,
    genericizeItemName,
    ensureWoodSpeciesTokens,
    getAvailableSpeciesForBase,
    maybeSelectIngredientSpecies
};

function ensureWoodSpeciesTokens(mcData) {
    let tokens = getWoodSpeciesTokens();
    if (!tokens) {
        tokens = new Set();
        try {
            const names = Object.keys(mcData?.itemsByName || {});
            for (const n of names) {
                if (n.endsWith('_planks')) {
                    const species = n.slice(0, -('_planks'.length));
                    if (species && species.length > 0) tokens.add(species);
                }
            }
        } catch (_) {}
        try { setWoodSpeciesTokens(tokens); } catch (_) {}
    }
    return tokens;
}

function getAvailableSpeciesForBase(mcData, base) {
    const out = [];
    try {
        const tokens = ensureWoodSpeciesTokens(mcData);
        for (const s of tokens) { if (mcData?.itemsByName?.[`${s}_${base}`]) out.push(s); }
    } catch (_) {}
    return out;
}

function maybeSelectIngredientSpecies(resultSpecies, base, mcData) {
    try {
        if (!resultSpecies) return null;
        const candidate = `${resultSpecies}_${base}`;
        return mcData && mcData.itemsByName && mcData.itemsByName[candidate] ? resultSpecies : null;
    } catch (_) { return null; }
}


