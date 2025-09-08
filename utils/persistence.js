const { getLastMcData } = require('./context');
const { getSuffixTokenFromName } = require('./items');

function buildPersistentNamesSet() {
    const s = new Set(['crafting_table', 'furnace']);
    const lastMcData = getLastMcData();
    if (lastMcData) {
        try {
            Object.values(lastMcData.blocks || {}).forEach(b => {
                if (b && b.harvestTools) {
                    Object.keys(b.harvestTools).forEach(id => {
                        const nm = lastMcData.items[id]?.name || String(id);
                        if (nm) s.add(nm);
                    });
                }
            });
            const toolSuffixes = new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']);
            Object.keys(lastMcData.itemsByName || {}).forEach(n => {
                const base = getSuffixTokenFromName(n);
                if (toolSuffixes.has(base)) s.add(n);
            });
        } catch (_) { /* ignore */ }
    }
    return s;
}

function isPersistentItemName(name, set) {
    return !!name && (set ? set.has(name) : buildPersistentNamesSet().has(name));
}

module.exports = {
    buildPersistentNamesSet,
    isPersistentItemName
};


