function enumerateActionPaths(tree) {
    function enumerate(node) {
        if (!node) return [];
        if (node.action === 'root') {
            const results = [];
            const children = node.children || [];
            children.forEach(child => {
                const childPaths = enumerate(child);
                results.push(...childPaths);
            });
            return results;
        }
        if (node.action === 'require') {
            const children = node.children || [];
            if (children.length === 0) return [];
            let combined = [[]];
            for (const child of children) {
                const childPaths = enumerate(child);
                if (childPaths.length === 0) return [];
                const nextCombined = [];
                combined.forEach(prefix => {
                    childPaths.forEach(seq => {
                        nextCombined.push(prefix.concat(seq));
                    });
                });
                combined = nextCombined;
            }
            return combined;
        }
        if (node.action === 'craft') {
            const children = node.children || [];
            if (children.length === 0) {
                return [[{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }]];
            }
            const perChildPaths = children.map(enumerate);
            if (perChildPaths.some(p => p.length === 0)) return [];
            let combined = [[]];
            perChildPaths.forEach(pathSet => {
                const nextCombined = [];
                combined.forEach(prefix => {
                    pathSet.forEach(childPath => {
                        nextCombined.push(prefix.concat(childPath));
                    });
                });
                combined = nextCombined;
            });
            combined = combined.map(seq => seq.concat([{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }]));
            return combined;
        }
        if ((node.action === 'mine' || node.action === 'hunt') && node.operator === 'OR' && node.children && node.children.length > 0) {
            const results = [];
            node.children.forEach(child => {
                const childPaths = enumerate(child);
                results.push(...childPaths);
            });
            return results;
        }
        if (node.action === 'smelt' && node.operator === 'OR' && node.children && node.children.length > 0) {
            const results = [];
            node.children.forEach(child => { results.push(...enumerate(child)); });
            return results;
        }
        if (node.action === 'smelt' && node.operator === 'AND' && node.children && node.children.length > 0) {
            let combined = [[]];
            for (const child of node.children) {
                const childPaths = enumerate(child);
                if (childPaths.length === 0) return [];
                const nextCombined = [];
                combined.forEach(prefix => childPaths.forEach(seq => nextCombined.push(prefix.concat(seq))));
                combined = nextCombined;
            }
            combined = combined.map(seq => seq.concat([{ action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }]));
            return combined;
        }
        if ((node.action === 'mine' || node.action === 'hunt') && (!node.children || node.children.length === 0)) {
            return [[{ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool, targetItem: node.targetItem }]];
        }
        return [];
    }
    return enumerate(tree);
}

module.exports = { enumerateActionPaths };




