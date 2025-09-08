function computePathWeight(path) {
    if (!Array.isArray(path)) return 0;
    let total = 0;
    for (const step of path) {
        if (!step || !step.action) continue;
        const count = Number(step.count) || 0;
        if (count <= 0) continue;
        if (step.action === 'craft') {
            total += (step.what === 'inventory' ? 1 : 10) * count;
        } else if (step.action === 'smelt') {
            total += 100 * count;
        } else if (step.action === 'mine') {
            total += 1000 * count;
        } else if (step.action === 'hunt') {
            total += 10000 * count;
        }
    }
    return total;
}

function stepWeight(step) {
    if (!step || !step.action) return 0;
    const count = Number(step.count) || 0;
    if (count <= 0) return 0;
    if (step.action === 'craft') return (step.what === 'inventory' ? 1 : 10) * count;
    if (step.action === 'smelt') return 100 * count;
    if (step.action === 'mine') return 1000 * count;
    if (step.action === 'hunt') return 10000 * count;
    return 0;
}

module.exports = {
    computePathWeight,
    stepWeight
};


