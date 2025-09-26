const { renderName } = require('../utils/render');

function printMiningPath(sources, depth, targetCount) {
    if (sources.length === 0) return;
    console.log(`${' '.repeat((depth + 1) * 2)}├─ mine (${targetCount}x)`);
    sources.forEach((source, index) => {
        const isLast = index === sources.length - 1;
        const toolInfo = source.tool === 'any' ? '' : ` (needs ${source.tool})`;
        console.log(`${' '.repeat((depth + 2) * 2)}${isLast ? '└─' : '├─'} ${source.block}${toolInfo}`);
    });
}

function printRecipeConversion(mcData, ingredientCounts, recipe, itemName, depth) {
    const ingredientList = Array.from(ingredientCounts.entries())
        .sort(([idA], [idB]) => idA - idB)
        .map(([id, count]) => `${count} ${mcData.items[id].name}`)
        .join(' + ');
    console.log(`${' '.repeat((depth + 2) * 2)}├─ ${ingredientList} to ${recipe.result.count} ${itemName}`);
}

function printHuntingPath(sources, depth, targetCount) {
    if (sources.length === 0) return;
    console.log(`${' '.repeat((depth + 1) * 2)}├─ hunt (${targetCount}x)`);
    sources.forEach((source, index) => {
        const isLast = index === sources.length - 1;
        const chanceInfo = source.dropChance ? ` (${source.dropChance * 100}% chance)` : '';
        console.log(`${' '.repeat((depth + 2) * 2)}${isLast ? '└─' : '├─'} ${source.mob}${chanceInfo}`);
    });
}

function logRecipeTree(tree, depth = 1) {
    if (!tree) return;
    const indent = ' '.repeat(depth * 2);
    if (tree.action === 'root') {
        const op = tree.operator === 'AND' ? 'ALL' : 'ANY';
        console.log(`${indent}├─ ${tree.what} (want ${tree.count}) [${op}]`);
        const children = tree.children || [];
        children.forEach((child, idx) => {
            const isLast = idx === children.length - 1;
            logRecipeNode(child, depth + 1, isLast);
        });
        return;
    }
    logRecipeNode(tree, depth, true);
}

function logRecipeNode(node, depth, isLastAtThisLevel) {
    const indent = ' '.repeat(depth * 2);
    const branch = isLastAtThisLevel ? '└─' : '├─';
    if (node.action === 'craft') {
        const op = node.operator === 'AND' ? 'ALL' : 'ANY';
        console.log(`${indent}${branch} craft in ${node.what} (${node.count}x) [${op}]`);
        if (node.ingredients && node.ingredients.length > 0 && node.result) {
            const ingredientsStr = node.ingredients.map(i => `${i.perCraftCount} ${renderName(i.item, i.meta)}`).join(' + ');
            const resultName = renderName(node.result.item, node.result.meta);
            console.log(`${' '.repeat((depth + 1) * 2)}├─ ${ingredientsStr} to ${node.result.perCraftCount} ${resultName}`);
        }
        const children = node.children || [];
        children.forEach((child, idx) => logRecipeTree(child, depth + 2));
        return;
    }
    if (node.action === 'mine') {
        if (node.children && node.children.length > 0) {
            const op = node.operator === 'AND' ? 'ALL' : 'ANY';
            const targetInfo = node.what ? ` for ${renderName(node.what)}` : '';
            console.log(`${indent}${branch} mine${targetInfo} (${node.count}x) [${op}]`);
            node.children.forEach((child, idx) => {
                if (child.action === 'require') {
                    logRecipeTree(child, depth + 1);
                } else {
                    const subIndent = ' '.repeat((depth + 1) * 2);
                    const subBranch = idx === node.children.length - 1 ? '└─' : '├─';
                    const toolInfo = child.tool && child.tool !== 'any' ? ` (needs ${child.tool})` : '';
                    const childTargetInfo = child.targetItem ? ` for ${renderName(child.targetItem)}` : '';
                    console.log(`${subIndent}${subBranch} ${renderName(child.what)}${childTargetInfo}${toolInfo}`);
                }
            });
        } else {
            const targetInfo = node.targetItem ? ` for ${renderName(node.targetItem)}` : '';
            console.log(`${indent}${branch} ${renderName(node.what)}${targetInfo}`);
        }
        return;
    }
    if (node.action === 'smelt') {
        if (node.children && node.children.length > 0) {
            const op = node.operator === 'AND' ? 'ALL' : 'ANY';
            const fuelInfo = node.fuel ? ` with ${renderName(node.fuel)}` : '';
            console.log(`${indent}${branch} smelt in furnace${fuelInfo} (${node.count}x) [${op}]`);
            if (node.input && node.result) {
                const ingStr = `${node.input.perSmelt} ${renderName(node.input.item)}`;
                const resStr = `${node.result.perSmelt} ${renderName(node.result.item)}`;
                console.log(`${' '.repeat((depth + 1) * 2)}├─ ${ingStr} to ${resStr}`);
            }
            node.children.forEach((child, idx) => logRecipeTree(child, depth + 1));
        } else {
            console.log(`${indent}${branch} smelt ${renderName(node.what)}`);
        }
        return;
    }
    if (node.action === 'require') {
        const op = node.operator === 'AND' ? 'ALL' : 'ANY';
        console.log(`${indent}${branch} require ${node.what.replace('tool:', '')} [${op}]`);
        const children = node.children || [];
        children.forEach((child, idx) => logRecipeTree(child, depth + 1));
        return;
    }
    if (node.action === 'hunt') {
        if (node.children && node.children.length > 0) {
            const op = node.operator === 'AND' ? 'ALL' : 'ANY';
            console.log(`${indent}${branch} hunt (${node.count}x) [${op}]`);
            node.children.forEach((child, idx) => {
                const subIndent = ' '.repeat((depth + 1) * 2);
                const subBranch = idx === node.children.length - 1 ? '└─' : '├─';
                const chance = child.dropChance ? ` (${child.dropChance * 100}% chance)` : '';
                const toolInfo = child.tool && child.tool !== 'any' ? ` (needs ${child.tool})` : '';
                const targetInfo = child.targetItem ? ` for ${renderName(child.targetItem)}` : '';
                console.log(`${subIndent}${subBranch} ${renderName(child.what)}${targetInfo}${chance}${toolInfo}`);
            });
        } else {
            console.log(`${indent}${branch} ${renderName(node.what)}`);
        }
        return;
    }
    if (node.action === 'root') {
        logRecipeTree(node, depth);
    }
}

module.exports = { logRecipeTree, printMiningPath, printRecipeConversion, printHuntingPath };


