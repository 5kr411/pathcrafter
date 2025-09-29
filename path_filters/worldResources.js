const { getWoodSpeciesTokens } = require('../utils/context');

function buildWorldAvailability(snapshot) {
    const blocks = new Map();
    const entities = new Map();

    // New snapshot shape: snapshot.blocks is an object map name -> { count, closestDistance, averageDistance }
    if (snapshot && snapshot.blocks && typeof snapshot.blocks === 'object' && !Array.isArray(snapshot.blocks)) {
        for (const name of Object.keys(snapshot.blocks)) {
            const rec = snapshot.blocks[name];
            const count = rec && Number.isFinite(rec.count) ? rec.count : 0;
            if (name && count > 0) blocks.set(name, count);
        }
    }

    // Entities similarly summarized by name
    if (snapshot && snapshot.entities && typeof snapshot.entities === 'object' && !Array.isArray(snapshot.entities)) {
        for (const name of Object.keys(snapshot.entities)) {
            const rec = snapshot.entities[name];
            const count = rec && Number.isFinite(rec.count) ? rec.count : 0;
            if (name && count > 0) entities.set(name, count);
        }
    }

    return {
        blocks,
        entities
    };
}

function computePathResourceDemand(path) {
    const blocks = new Map();
    const entities = new Map();

    if (Array.isArray(path)) {
        for (const step of path) {
            if (!step) continue;
            if (step.action === 'mine') {
                const name = step.what;
                const count = Math.max(1, step.count || 1);
                if (name) blocks.set(name, (blocks.get(name) || 0) + count);
            } else if (step.action === 'hunt') {
                const name = step.what;
                const count = Math.max(1, step.count || 1);
                const chance = typeof step.dropChance === 'number' && step.dropChance > 0 && step.dropChance <= 1 ? step.dropChance : 1;
                const requiredEncounters = Math.ceil(count / chance);
                if (name) entities.set(name, (entities.get(name) || 0) + requiredEncounters);
            }
        }
    }

    return { blocks, entities };
}

function getAvailableCountForName(name, availability, options = {}) {
    if (!name) return 0;
    const disableGenericWood = !!options.disableGenericWood;
    if (!disableGenericWood && String(name).startsWith('generic_')) {
        const base = String(name).slice('generic_'.length);
        const speciesTokens = getWoodSpeciesTokens();
        let sum = 0;
        if (speciesTokens && speciesTokens.size > 0) {
            for (const species of speciesTokens) {
                sum += availability.blocks.get(`${species}_${base}`) || 0;
            }
            return sum;
        }
        // Fallback: sum any block ending with _<base>
        for (const [key, value] of availability.blocks.entries()) {
            if (typeof key === 'string' && key.endsWith(`_${base}`)) sum += value;
        }
        return sum;
    }
    // If name is species-specific like oak_log and species tokens are known, treat as family-flexible (unless disabled)
    const idx = String(name).lastIndexOf('_');
    if (idx > 0) {
        const prefix = String(name).slice(0, idx);
        const base = String(name).slice(idx + 1);
        const speciesTokens = getWoodSpeciesTokens();
        if (!disableGenericWood && speciesTokens && speciesTokens.has && speciesTokens.has(prefix)) {
            let sum = 0;
            for (const species of speciesTokens) {
                sum += availability.blocks.get(`${species}_${base}`) || 0;
            }
            return sum;
        }
    }
    return availability.blocks.get(name) || 0;
}

function isDemandSatisfiedByAvailability(demand, availability, options = {}) {
    for (const [name, need] of demand.blocks.entries()) {
        const have = getAvailableCountForName(name, availability, options);
        if (have < need) return false;
    }
    for (const [name, need] of demand.entities.entries()) {
        const have = availability.entities.get(name) || 0;
        if (have < need) return false;
    }
    return true;
}

function explainDemandShortfall(demand, availability, options = {}) {
    const missing = { blocks: [], entities: [] };
    for (const [name, need] of demand.blocks.entries()) {
        const have = getAvailableCountForName(name, availability, options);
        if (have < need) missing.blocks.push({ name, need, have });
    }
    for (const [name, need] of demand.entities.entries()) {
        const have = availability.entities.get(name) || 0;
        if (have < need) missing.entities.push({ name, need, have });
    }
    return missing;
}

module.exports = {
    buildWorldAvailability,
    computePathResourceDemand,
    isDemandSatisfiedByAvailability,
    explainDemandShortfall
};


