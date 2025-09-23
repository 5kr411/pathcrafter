const { renderName } = require('../utils/render');
const pathUtils = require('../utils/pathUtils');

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

function logActionPath(path) {
    const parts = path.map(step => {
        if (step.action === 'craft') {
            const ing = step.ingredients && step.ingredients.length > 0
                ? `${step.ingredients.map(i => `${i.perCraftCount} ${renderName(i.item, i.meta)}`).join(' + ')} to `
                : '';
            const res = step.result ? `${step.result.perCraftCount} ${renderName(step.result.item, step.result.meta)}` : 'unknown';
            return `craft in ${step.what} (${step.count}x): ${ing}${res}`;
        }
        if (step.action === 'smelt') {
            const ing = step.input ? `${step.input.perSmelt} ${renderName(step.input.item)}` : '';
            const res = step.result ? `${step.result.perSmelt} ${renderName(step.result.item)}` : 'unknown';
            const fuel = step.fuel ? ` with ${renderName(step.fuel)}` : '';
            return `smelt in furnace${fuel} (${step.count}x): ${ing} to ${res}`;
        }
        if (step.action === 'require') {
            return `require ${String(step.what).replace('tool:', '')}`;
        }
        if (step.action === 'mine') {
            const tool = step.tool && step.tool !== 'any' ? `, needs ${step.tool}` : '';
            const forWhat = step.targetItem ? ` for ${renderName(step.targetItem)}` : '';
            return `mine ${renderName(step.what)}${forWhat} (${step.count}x${tool})`;
        }
        if (step.action === 'hunt') {
            const chance = step.dropChance ? `, ${step.dropChance * 100}% chance` : '';
            const tool = step.tool && step.tool !== 'any' ? `, needs ${step.tool}` : '';
            const forWhat = step.targetItem ? ` for ${renderName(step.targetItem)}` : '';
            return `hunt ${renderName(step.what)}${forWhat} (${step.count}x${chance}${tool})`;
        }
        return `${step.action} ${renderName(step.what)} (${step.count}x)`;
    });
    const weight = typeof pathUtils.computePathWeight === 'function' ? pathUtils.computePathWeight(path) : 0;
    console.log(`${parts.join(' -> ')} (w=${weight})`);
}

function logActionPaths(paths) {
    paths.forEach((p, idx) => {
        process.stdout.write(`#${idx + 1} `);
        logActionPath(p);
    });
}

module.exports = { logRecipeTree, printMiningPath, printRecipeConversion, printHuntingPath, logActionPath, logActionPaths };




