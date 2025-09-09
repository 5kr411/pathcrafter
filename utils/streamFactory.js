function createMakeStream(makeLeafStream, makeOrStream, makeAndStream) {
    return function makeStream(node) {
        if (!node) return function* () { };
        if (!node.children || node.children.length === 0) {
            if (node.action === 'craft') { return makeLeafStream({ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }); }
            if (node.action === 'smelt') { return makeLeafStream({ action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }); }
            if (node.action === 'mine' || node.action === 'hunt') { return makeLeafStream({ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool, targetItem: node.targetItem }); }
            if (node.action === 'require') return function* () { };
            return function* () { };
        }
        if (node.action === 'root') { return makeOrStream((node.children || []).map(makeStream)); }
        if (node.action === 'require') { return makeAndStream((node.children || []).map(makeStream), null); }
        if (node.action === 'craft') { const step = { action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }; return makeAndStream((node.children || []).map(makeStream), step); }
        if (node.action === 'smelt') { if (node.operator === 'OR') return makeOrStream((node.children || []).map(makeStream)); const step = { action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }; return makeAndStream((node.children || []).map(makeStream), step); }
        if (node.action === 'mine' || node.action === 'hunt') { if (node.operator === 'OR') return makeOrStream((node.children || []).map(makeStream)); }
        return makeOrStream((node.children || []).map(makeStream));
    };
}

module.exports = { createMakeStream };


