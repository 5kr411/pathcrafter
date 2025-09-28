function buildWorldAvailability(snapshot) {
    const blocks = new Map();
    const entities = new Map();

    if (snapshot && Array.isArray(snapshot.blocks)) {
        for (const b of snapshot.blocks) {
            const name = b && b.name;
            if (!name) continue;
            blocks.set(name, (blocks.get(name) || 0) + 1);
        }
    }

    if (snapshot && Array.isArray(snapshot.entities)) {
        for (const e of snapshot.entities) {
            const name = e && (e.name || e.type || e.kind);
            if (!name) continue;
            entities.set(name, (entities.get(name) || 0) + 1);
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

function isDemandSatisfiedByAvailability(demand, availability) {
    for (const [name, need] of demand.blocks.entries()) {
        const have = availability.blocks.get(name) || 0;
        if (have < need) return false;
    }
    for (const [name, need] of demand.entities.entries()) {
        const have = availability.entities.get(name) || 0;
        if (have < need) return false;
    }
    return true;
}

module.exports = {
    buildWorldAvailability,
    computePathResourceDemand,
    isDemandSatisfiedByAvailability
};


