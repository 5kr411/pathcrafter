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

module.exports = {
    dedupePersistentAcquisitions
};


