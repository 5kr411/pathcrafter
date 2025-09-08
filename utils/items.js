function chooseMinimalToolName(toolNames) {
    if (!toolNames || toolNames.length === 0) return undefined;
    const tierRank = {
        wooden: 0,
        golden: 0.5,
        stone: 1,
        iron: 2,
        diamond: 3,
        netherite: 4
    };
    function rank(name) {
        const first = String(name).split('_')[0];
        const base = tierRank[first];
        if (base === undefined) return 10;
        return base;
    }
    let best = toolNames[0];
    let bestRank = rank(best);
    for (let i = 1; i < toolNames.length; i++) {
        const r = rank(toolNames[i]);
        if (r < bestRank) { best = toolNames[i]; bestRank = r; }
    }
    return best;
}

function getSuffixTokenFromName(name) {
    if (!name) return name;
    const idx = name.lastIndexOf('_');
    if (idx === -1) return name;
    return name.slice(idx + 1);
}

module.exports = {
    chooseMinimalToolName,
    getSuffixTokenFromName
};


