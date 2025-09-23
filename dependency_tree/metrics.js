function computeTreeMaxDepth(node) {
    if (!node) return 0;
    if (!node.children || node.children.length === 0) return 1;
    let maxChild = 0;
    for (const child of node.children) {
        const d = computeTreeMaxDepth(child);
        if (d > maxChild) maxChild = d;
    }
    return 1 + maxChild;
}

function countActionPaths(node) {
    if (!node) return 0;
    if (!node.children || node.children.length === 0) {
        return node.action === 'root' ? 0 : 1;
    }
    if (node.action === 'craft' || node.action === 'require' || node.operator === 'AND') {
        let total = 1;
        for (const child of node.children) total *= countActionPaths(child);
        return total;
    }
    let sum = 0;
    for (const child of node.children) sum += countActionPaths(child);
    return sum;
}

module.exports = { computeTreeMaxDepth, countActionPaths };




