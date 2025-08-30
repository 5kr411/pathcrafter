const minecraftData = require('minecraft-data')

function resolveMcData(ctx) {
    if (!ctx) return undefined;
    if (typeof ctx === 'string') return minecraftData(ctx);
    if (ctx.itemsByName && ctx.items && ctx.blocks && ctx.recipes) return ctx;
    if (typeof ctx === 'object' && ctx.version) return minecraftData(ctx.version);
    return undefined;
}

function requiresCraftingTable(recipe) {
    if (recipe.ingredients) return false;
    if (recipe.inShape) {
        const tooWide = recipe.inShape.some(row => row.length > 2);
        const tooTall = recipe.inShape.length > 2;
        return tooWide || tooTall;
    }
    return false;
}

function findBlocksThatDrop(mcData, itemName) {
    const sources = [];
    const item = mcData.itemsByName[itemName];

    if (!item) return sources;

    Object.values(mcData.blocks).forEach(block => {
        if (block.drops && block.drops.includes(item.id)) {
            sources.push({
                block: block.name,
                tool: block.harvestTools ?
                    Object.keys(block.harvestTools).map(id => mcData.items[id]?.name || id).join('/') :
                    'any'
            });
        }
    });

    return sources;
}

function printMiningPath(sources, depth, targetCount) {
    if (sources.length === 0) return;

    console.log(`${' '.repeat((depth + 1) * 2)}├─ mine (${targetCount}x)`);
    sources.forEach((source, index) => {
        const isLast = index === sources.length - 1;
        const toolInfo = source.tool === 'any' ? '' : ` (needs ${source.tool})`;
        console.log(`${' '.repeat((depth + 2) * 2)}${isLast ? '└─' : '├─'} ${source.block}${toolInfo}`);
    });
}

function getIngredientCounts(recipe) {
    const ingredients = recipe.ingredients || recipe.inShape?.flat().filter(Boolean);
    if (!ingredients) return new Map();

    const ingredientCounts = new Map();
    [...ingredients].sort((a, b) => a - b).forEach(id => {
        ingredientCounts.set(id, (ingredientCounts.get(id) || 0) + 1);
    });
    return ingredientCounts;
}

function hasCircularDependency(mcData, itemId, ingredientId) {
    const ingredientRecipes = mcData.recipes[ingredientId] || [];
    return ingredientRecipes.some(r =>
        (r.ingredients && r.ingredients.includes(itemId)) ||
        (r.inShape && r.inShape.some(row => row.includes(itemId)))
    );
}

function printRecipeConversion(mcData, ingredientCounts, recipe, itemName, depth) {
    const ingredientList = Array.from(ingredientCounts.entries())
        .sort(([idA], [idB]) => idA - idB)
        .map(([id, count]) => `${count} ${mcData.items[id].name}`)
        .join(' + ');
    console.log(`${' '.repeat((depth + 2) * 2)}├─ ${ingredientList} to ${recipe.result.count} ${itemName}`);
}

function findMobsThatDrop(mcData, itemName) {
    const sources = [];
    const item = mcData.itemsByName[itemName];

    if (!item) return sources;

    Object.entries(mcData.entityLoot || {}).forEach(([entityId, lootTable]) => {
        if (lootTable && lootTable.drops) {
            const hasItem = lootTable.drops.some(drop => {
                const dropItemName = drop.item?.toLowerCase().replace(' ', '_');
                return dropItemName === itemName;
            });

            if (hasItem) {
                sources.push({
                    mob: lootTable.entity,
                    dropChance: lootTable.drops.find(d =>
                        d.item?.toLowerCase().replace(' ', '_') === itemName
                    )?.dropChance
                });
            }
        }
    });

    return sources;
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

function buildRecipeTree(ctx, itemName, targetCount = 1, context = {}) {
    const mcData = resolveMcData(ctx);
    const item = mcData?.itemsByName[itemName];
    const root = { action: 'root', operator: 'OR', what: itemName, count: targetCount, children: [] };

    if (!mcData || !item) return root;
    const avoidTool = context.avoidTool;
    const visited = context.visited instanceof Set ? context.visited : new Set();
    if (visited.has(itemName)) return root;
    const nextVisited = new Set(visited);
    nextVisited.add(itemName);

    const recipes = (mcData.recipes[item.id] || []).sort((a, b) => b.result.count - a.result.count);
    recipes.forEach(recipe => {
        const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
        const ingredientCounts = getIngredientCounts(recipe);
        const craftNode = {
            action: 'craft',
            operator: 'AND',
            what: requiresCraftingTable(recipe) ? 'table' : 'inventory',
            count: craftingsNeeded,
            result: { item: itemName, perCraftCount: recipe.result.count },
            ingredients: Array.from(ingredientCounts.entries())
                .sort(([a], [b]) => a - b)
                .map(([id, count]) => ({ item: mcData.items[id]?.name, perCraftCount: count })),
            children: []
        };

        Array.from(ingredientCounts.entries())
            .sort(([a], [b]) => a - b)
            .forEach(([ingredientId, count]) => {
                const ingredientItem = mcData.items[ingredientId];
                if (!ingredientItem) return;

                if (hasCircularDependency(mcData, item.id, ingredientId)) {
                    const sources = findBlocksThatDrop(mcData, ingredientItem.name);
                    if (sources.length > 0) {
                        const neededCount = count * craftingsNeeded;
                        const miningGroup = {
                            action: 'mine',
                            operator: 'OR',
                            what: ingredientItem.name,
                            count: neededCount,
                            children: sources.flatMap(s => {
                                if (!s.tool || s.tool === 'any') {
                                    return [{ action: 'mine', what: s.block, count: neededCount, children: [] }];
                                }
                                const tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);
                                return tools.map(toolName => ({
                                    action: 'require',
                                    operator: 'AND',
                                    what: `tool:${toolName}`,
                                    count: 1,
                                    children: [
                                        buildRecipeTree(mcData, toolName, 1, { avoidTool: toolName, visited: nextVisited }),
                                        { action: 'mine', what: s.block, tool: toolName, count: neededCount, children: [] }
                                    ]
                                }));
                            })
                        };
                        craftNode.children.push(miningGroup);
                    }
                } else {
                    const ingredientTree = buildRecipeTree(mcData, ingredientItem.name, count * craftingsNeeded, { ...context, visited: nextVisited });
                    craftNode.children.push(ingredientTree);
                }
            });

        if (craftNode.what === 'table') {
            const requireTable = {
                action: 'require',
                operator: 'AND',
                what: 'crafting_table',
                count: 1,
                children: [
                    buildRecipeTree(mcData, 'crafting_table', 1, { ...context, visited: nextVisited }),
                    craftNode
                ]
            };
            root.children.push(requireTable);
        } else {
            root.children.push(craftNode);
        }
    });

    const miningPaths = findBlocksThatDrop(mcData, itemName);
    if (miningPaths.length > 0) {
        const mineGroup = {
            action: 'mine',
            operator: 'OR',
            what: itemName,
            count: targetCount,
            children: miningPaths.flatMap(s => {
                if (!s.tool || s.tool === 'any') {
                    return [{ action: 'mine', what: s.block, count: targetCount, children: [] }];
                }
                const tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);
                return tools.map(toolName => ({
                    action: 'require',
                    operator: 'AND',
                    what: `tool:${toolName}`,
                    count: 1,
                    children: [
                        buildRecipeTree(mcData, toolName, 1, { avoidTool: toolName, visited: nextVisited }),
                        { action: 'mine', what: s.block, tool: toolName, count: targetCount, children: [] }
                    ]
                }));
            })
        };
        root.children.push(mineGroup);
    }

    const huntingPaths = findMobsThatDrop(mcData, itemName);
    if (huntingPaths.length > 0) {
        const huntGroup = {
            action: 'hunt',
            operator: 'OR',
            what: itemName,
            count: targetCount,
            children: huntingPaths.map(s => {
                const p = s.dropChance && s.dropChance > 0 ? s.dropChance : 1;
                const expectedKills = Math.ceil(targetCount / p);
                return { action: 'hunt', what: s.mob, count: expectedKills, dropChance: s.dropChance, children: [] };
            })
        };
        root.children.push(huntGroup);
    }

    return root;
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
            const ingredientsStr = node.ingredients.map(i => `${i.perCraftCount} ${i.item}`).join(' + ');
            console.log(`${' '.repeat((depth + 1) * 2)}├─ ${ingredientsStr} to ${node.result.perCraftCount} ${node.result.item}`);
        }
        const children = node.children || [];
        children.forEach((child, idx) => logRecipeTree(child, depth + 2));
        return;
    }
    if (node.action === 'mine') {
        if (node.children && node.children.length > 0) {
            const op = node.operator === 'AND' ? 'ALL' : 'ANY';
            console.log(`${indent}${branch} mine (${node.count}x) [${op}]`);
            node.children.forEach((child, idx) => {
                if (child.action === 'require') {
                    logRecipeTree(child, depth + 1);
                } else {
                    const subIndent = ' '.repeat((depth + 1) * 2);
                    const subBranch = idx === node.children.length - 1 ? '└─' : '├─';
                    const toolInfo = child.tool && child.tool !== 'any' ? ` (needs ${child.tool})` : '';
                    console.log(`${subIndent}${subBranch} ${child.what}${toolInfo}`);
                }
            });
        } else {
            console.log(`${indent}${branch} ${node.what}`);
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
                console.log(`${subIndent}${subBranch} ${child.what}${chance}${toolInfo}`);
            });
        } else {
            console.log(`${indent}${branch} ${node.what}`);
        }
        return;
    }
    if (node.action === 'root') {
        logRecipeTree(node, depth);
    }
}

function analyzeRecipes(ctx, itemName, targetCount = 1, options = {}) {
    const tree = buildRecipeTree(ctx, itemName, targetCount);
    if (!options || options.log !== false) logRecipeTree(tree);
    return tree;
}

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
            // AND semantics: concatenate sequences of all children in order
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
        if ((node.action === 'mine' || node.action === 'hunt') && (!node.children || node.children.length === 0)) {
            return [[{ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool }]];
        }
        return [];
    }
    return enumerate(tree);
}

function enumerateActionPathsGenerator(tree) {
    function* enumerate(node) {
        if (!node) return;
        if (node.action === 'root') {
            const children = node.children || [];
            for (const child of children) {
                yield* enumerate(child);
            }
            return;
        }
        if (node.action === 'require') {
            const children = node.children || [];
            if (children.length === 0) return;
            function* combine(idx, prefix) {
                if (idx >= children.length) {
                    yield prefix;
                    return;
                }
                for (const seg of enumerate(children[idx])) {
                    yield* combine(idx + 1, prefix.concat(seg));
                }
            }
            yield* combine(0, []);
            return;
        }
        if (node.action === 'craft') {
            const children = node.children || [];
            if (children.length === 0) {
                yield [{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }];
                return;
            }
            function* combine(idx, prefix) {
                if (idx >= children.length) {
                    yield prefix.concat([{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }]);
                    return;
                }
                for (const seg of enumerate(children[idx])) {
                    yield* combine(idx + 1, prefix.concat(seg));
                }
            }
            yield* combine(0, []);
            return;
        }
        if ((node.action === 'mine' || node.action === 'hunt') && node.operator === 'OR' && node.children && node.children.length > 0) {
            for (const child of node.children) {
                yield* enumerate(child);
            }
            return;
        }
        if ((node.action === 'mine' || node.action === 'hunt') && (!node.children || node.children.length === 0)) {
            yield [{ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool }];
            return;
        }
    }
    return enumerate(tree);
}

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
        // Leaf action contributes one concrete step sequence
        return node.action === 'root' ? 0 : 1;
    }
    // AND vs OR semantics
    if (node.action === 'craft' || node.action === 'require' || node.operator === 'AND') {
        let total = 1;
        for (const child of node.children) total *= countActionPaths(child);
        return total;
    }
    // Default OR semantics (root, mine group, hunt group)
    let sum = 0;
    for (const child of node.children) sum += countActionPaths(child);
    return sum;
}

function logActionPath(path) {
    const parts = path.map(step => {
        if (step.action === 'craft') {
            const ing = step.ingredients && step.ingredients.length > 0
                ? `${step.ingredients.map(i => `${i.perCraftCount} ${i.item}`).join(' + ')} to `
                : '';
            const res = step.result ? `${step.result.perCraftCount} ${step.result.item}` : 'unknown';
            return `craft in ${step.what} (${step.count}x): ${ing}${res}`;
        }
        if (step.action === 'require') {
            return `require ${String(step.what).replace('tool:', '')}`;
        }
        if (step.action === 'mine') {
            const tool = step.tool && step.tool !== 'any' ? `, needs ${step.tool}` : '';
            return `mine ${step.what} (${step.count}x${tool})`;
        }
        if (step.action === 'hunt') {
            const chance = step.dropChance ? `, ${step.dropChance * 100}% chance` : '';
            const tool = step.tool && step.tool !== 'any' ? `, needs ${step.tool}` : '';
            return `hunt ${step.what} (${step.count}x${chance}${tool})`;
        }
        return `${step.action} ${step.what} (${step.count}x)`;
    });
    console.log(parts.join(' -> '));
}

function logActionPaths(paths) {
    paths.forEach((p, idx) => {
        process.stdout.write(`#${idx + 1} `);
        logActionPath(p);
    });
}

function enumerateShortestPathsGenerator(tree) {
    function MinHeap(compare) {
        this.compare = compare; this.data = [];
    }
    MinHeap.prototype.push = function (item) {
        const a = this.data; a.push(item); let i = a.length - 1;
        while (i > 0) { const p = Math.floor((i - 1) / 2); if (this.compare(a[i], a[p]) >= 0) break; const t = a[i]; a[i] = a[p]; a[p] = t; i = p; }
    };
    MinHeap.prototype.pop = function () {
        const a = this.data; if (a.length === 0) return undefined; const top = a[0]; const last = a.pop();
        if (a.length) { a[0] = last; let i = 0; while (true) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < a.length && this.compare(a[l], a[s]) < 0) s = l; if (r < a.length && this.compare(a[r], a[s]) < 0) s = r; if (s === i) break; const t = a[i]; a[i] = a[s]; a[s] = t; i = s; } }
        return top;
    };
    MinHeap.prototype.size = function () { return this.data.length; };

    function makeLeafStream(step) { return function* () { yield { path: [step], length: 1 }; }; }

    function makeOrStream(childStreams) {
        return function* () {
            const heap = new MinHeap((a, b) => a.item.length - b.item.length);
            const gens = childStreams.map(s => s());
            gens.forEach((g, idx) => { const n = g.next(); if (!n.done) heap.push({ idx, gen: g, item: n.value }); });
            while (heap.size() > 0) { const { idx, gen, item } = heap.pop(); yield item; const n = gen.next(); if (!n.done) heap.push({ idx, gen, item: n.value }); }
        };
    }

    function makeAndStream(childStreams, parentStepOrNull) {
        return function* () {
            const streams = childStreams.map(s => ({ gen: s(), buf: [], done: false }));
            function ensure(i, j) {
                const st = streams[i];
                while (!st.done && st.buf.length <= j) { const n = st.gen.next(); if (n.done) { st.done = true; break; } st.buf.push(n.value); }
                return st.buf.length > j;
            }
            for (let i = 0; i < streams.length; i++) { if (!ensure(i, 0)) return; }
            const heap = new MinHeap((a, b) => a.length - b.length);
            const visited = new Set();
            const initIdx = new Array(streams.length).fill(0);
            function idxKey(idxArr) { return idxArr.join(','); }
            function sumLen(idxArr) { let s = 0; for (let i = 0; i < idxArr.length; i++) s += streams[i].buf[idxArr[i]].length; if (parentStepOrNull) s += 1; return s; }
            heap.push({ idx: initIdx, length: sumLen(initIdx) }); visited.add(idxKey(initIdx));
            while (heap.size() > 0) {
                const node = heap.pop();
                const parts = []; for (let i = 0; i < node.idx.length; i++) parts.push(streams[i].buf[node.idx[i]].path);
                let combined = parts.flat(); if (parentStepOrNull) combined = combined.concat([parentStepOrNull]);
                yield { path: combined, length: combined.length };
                for (let d = 0; d < streams.length; d++) {
                    const nextIdx = node.idx.slice(); nextIdx[d] += 1; if (!ensure(d, nextIdx[d])) continue; const k = idxKey(nextIdx); if (visited.has(k)) continue; visited.add(k); heap.push({ idx: nextIdx, length: sumLen(nextIdx) });
                }
            }
        };
    }

    function makeStream(node) {
        if (!node) return function* () { };
        if (!node.children || node.children.length === 0) {
            if (node.action === 'craft') { return makeLeafStream({ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }); }
            if (node.action === 'mine' || node.action === 'hunt') { return makeLeafStream({ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool }); }
            if (node.action === 'require') return function* () { };
            return function* () { };
        }
        if (node.action === 'root') { return makeOrStream((node.children || []).map(makeStream)); }
        if (node.action === 'mine' || node.action === 'hunt') { if (node.operator === 'OR') return makeOrStream((node.children || []).map(makeStream)); }
        if (node.action === 'require') { return makeAndStream((node.children || []).map(makeStream), null); }
        if (node.action === 'craft') { const step = { action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }; return makeAndStream((node.children || []).map(makeStream), step); }
        return makeOrStream((node.children || []).map(makeStream));
    }
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) yield item.path; })();
}

analyzeRecipes._internals = {
    resolveMcData,
    requiresCraftingTable,
    findBlocksThatDrop,
    printMiningPath,
    getIngredientCounts,
    hasCircularDependency,
    printRecipeConversion,
    findMobsThatDrop,
    printHuntingPath,
    buildRecipeTree,
    logRecipeTree,
    enumerateActionPaths,
    enumerateShortestPathsGenerator,
    enumerateActionPathsGenerator,
    computeTreeMaxDepth,
    countActionPaths,
    logActionPath,
    logActionPaths
};

module.exports = analyzeRecipes;
