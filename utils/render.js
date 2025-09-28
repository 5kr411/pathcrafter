const { getTargetItemNameGlobal, getLastMcData } = require('./context');
const { getSuffixTokenFromName } = require('./items');
const { genericizeItemName } = require('./wood');
const { getGenericWoodEnabled } = require('./config');

function renderName(name, meta) {
    if (!name) return name;
    const targetName = typeof getTargetItemNameGlobal === 'function' ? getTargetItemNameGlobal() : null;
    if (targetName && name === targetName) return name;
    if (meta && meta.selectedSpecies) {
        const base = getSuffixTokenFromName(name);
        const forced = `${meta.selectedSpecies}_${base}`;
        const mc = typeof getLastMcData === 'function' ? getLastMcData() : null;
        if (mc?.itemsByName?.[forced]) return forced;
        return name;
    }
    if (meta && meta.generic) {
        if (!getGenericWoodEnabled()) return name;
        const base = getSuffixTokenFromName(name);
        return `generic_${base}`;
    }
    return genericizeItemName(name);
}

module.exports = { renderName };


