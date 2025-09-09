function makeSupplyFromInventory(inv) {
    const m = new Map();
    if (!inv) return m;
    for (const [k, v] of Object.entries(inv)) {
        const n = Number(v);
        if (!Number.isNaN(n) && n > 0) m.set(k, n);
    }
    return m;
}

function mapToInventoryObject(map) {
    const o = {};
    if (!map) return o;
    for (const [k, v] of map.entries()) {
        if (v > 0) o[k] = v;
    }
    return o;
}

function produced(step) {
    if (!step) return null;
    if (step.action === 'craft' && step.result && step.result.item) return step.result.item;
    if (step.action === 'smelt' && step.result && step.result.item) return step.result.item;
    if ((step.action === 'mine' || step.action === 'hunt') && (step.targetItem || step.what)) return (step.targetItem || step.what);
    return null;
}

module.exports = {
    makeSupplyFromInventory,
    mapToInventoryObject,
    produced
};


