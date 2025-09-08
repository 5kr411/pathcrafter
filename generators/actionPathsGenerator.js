const { getLastMcData } = require('../utils/context');
const { getSuffixTokenFromName } = require('../utils/items');
const { getSmeltsPerUnitForFuel } = require('../smeltingConfig');

function enumerateActionPathsGenerator(tree, options = {}) {
    const invObj = options && options.inventory && typeof options.inventory === 'object' ? options.inventory : null;

    const persistentNames = (() => {
        const s = new Set(['crafting_table', 'furnace']);
        const lastMcData = getLastMcData();
        if (lastMcData) {
            try {
                Object.values(lastMcData.blocks || {}).forEach(b => {
                    if (b && b.harvestTools) {
                        Object.keys(b.harvestTools).forEach(id => {
                            const nm = lastMcData.items[id]?.name || String(id);
                            if (nm) s.add(nm);
                        });
                    }
                });
                const toolSuffixes = new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']);
                Object.keys(lastMcData.itemsByName || {}).forEach(n => {
                    const base = getSuffixTokenFromName(n);
                    if (toolSuffixes.has(base)) s.add(n);
                });
            } catch (_) { /* ignore */ }
        }
        return s;
    })();
    function isPersistentItemName(name) { return !!name && persistentNames.has(name); }

    function persistentSetFromInventory(inv) {
        const have = new Set();
        if (!inv) return have;
        for (const [k, v] of Object.entries(inv)) {
            if ((v || 0) > 0 && isPersistentItemName(k)) have.add(k);
        }
        return have;
    }

    function requiredPersistentFromRequire(node) {
        const what = String(node.what || '');
        if (what.startsWith('tool:')) return what.slice(5);
        if (what === 'crafting_table' || what === 'furnace') return what;
        return null;
    }

    function applyPersistentFromSteps(haveSet, steps) {
        const have = new Set(haveSet);
        for (const st of steps) {
            if (st && st.action === 'craft' && st.result && isPersistentItemName(st.result.item)) have.add(st.result.item);
            if (st && st.action === 'smelt' && st.result && isPersistentItemName(st.result.item)) have.add(st.result.item);
            if (st && st.action === 'mine' && st.what && isPersistentItemName(st.what)) have.add(st.what);
        }
        return have;
    }

    const { makeSupplyFromInventory } = require('../utils/inventory');
    const initialSupply = makeSupplyFromInventory(invObj);

    const { isPathValidBasic } = require('../utils/pathValidation');
    function isPathValid(path) { return isPathValidBasic(path, initialSupply, getSmeltsPerUnitForFuel); }

    const { dedupePersistentAcquisitions } = require('../utils/sanitizer');
    function sanitizePath(path) {
        const filtered = dedupePersistentAcquisitions(path, isPersistentItemName);

        const need = new Map();
        (function seedFinalDemand() {
            for (let i = filtered.length - 1; i >= 0; i--) {
                const st = filtered[i];
                if (!st) continue;
                if (st.action === 'craft') {
                    const out = st.result?.item;
                    const outCount = (st.result?.perCraftCount || 1) * (st.count || 1);
                    if (out && outCount > 0) { need.set(out, (need.get(out) || 0) + outCount); break; }
                }
                if (st.action === 'smelt') {
                    const out = st.result?.item;
                    const outCount = (st.result?.perSmelt || 1) * (st.count || 1);
                    if (out && outCount > 0) { need.set(out, (need.get(out) || 0) + outCount); break; }
                }
                if (st.action === 'mine' || st.action === 'hunt') {
                    const out = st.targetItem || st.what;
                    const outCount = (st.count || 1);
                    if (out && outCount > 0) { need.set(out, (need.get(out) || 0) + outCount); break; }
                }
            }
        })();
        const keep = new Array(filtered.length).fill(false);
        function incNeed(name, count) { if (!name || count <= 0) return; need.set(name, (need.get(name) || 0) + count); }
        function decNeed(name, count) { if (!name || count <= 0) return; const cur = need.get(name) || 0; const next = cur - count; if (next > 0) need.set(name, next); else need.delete(name); }
        for (let i = filtered.length - 1; i >= 0; i--) {
            const st = filtered[i];
            if (!st) continue;
            if (st.action === 'smelt') {
                keep[i] = true;
                const inCount = (st.input?.perSmelt || 1) * (st.count || 1);
                incNeed(st.input?.item, inCount);
                if (st.fuel) {
                    try {
                        const perFuel = getSmeltsPerUnitForFuel(st.fuel) || 0;
                        const fuelNeed = perFuel > 0 ? Math.ceil((st.count || 1) / perFuel) : (st.count || 1);
                        incNeed(st.fuel, fuelNeed);
                    } catch (_) { incNeed(st.fuel, 1); }
                }
                continue;
            }
            if (st.action === 'craft') {
                const out = st.result?.item;
                const outCount = (st.result?.perCraftCount || 1) * (st.count || 1);
                const demand = out ? (need.get(out) || 0) : 0;
                if (demand <= 0 && !(out && isPersistentItemName(out))) {
                    keep[i] = false;
                    continue;
                }
                keep[i] = true;
                if (Array.isArray(st.ingredients)) {
                    for (const ing of st.ingredients) incNeed(ing?.item, (ing?.perCraftCount || 0) * (st.count || 1));
                }
                if (out) decNeed(out, outCount);
                continue;
            }
            if (st.action === 'mine' || st.action === 'hunt') {
                const out = st.targetItem || st.what;
                const demand = need.get(out) || 0;
                if (demand > 0) { keep[i] = true; decNeed(out, st.count || 1); } else { keep[i] = false; }
                continue;
            }
            keep[i] = true;
        }
        const out = filtered.filter((_, idx) => keep[idx]);
        try { if (!isPathValid(out)) return path; } catch (_) { return path; }
        return out;
    }

    function* enumerate(node, have) {
        if (!node) return;
        if (node.action === 'root') {
            const children = node.children || [];
            for (const child of children) yield* enumerate(child, have);
            return;
        }
        if (node.action === 'require') {
            const children = node.children || [];
            const reqName = requiredPersistentFromRequire(node);
            const startIdx = (reqName && have && have.has(reqName)) ? 1 : 0;
            function* enumerateChildren(idx, accSteps, haveNow) {
                if (idx >= children.length) { yield accSteps; return; }
                for (const seg of enumerate(children[idx], haveNow)) {
                    const haveNext = applyPersistentFromSteps(haveNow, seg);
                    yield* enumerateChildren(idx + 1, accSteps.concat(seg), haveNext);
                }
            }
            yield* enumerateChildren(startIdx, [], have || new Set());
            return;
        }
        if (node.action === 'craft') {
            const children = node.children || [];
            if (children.length === 0) { yield [{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }]; return; }
            function* enumerateChildren(idx, accSteps, haveNow) {
                if (idx >= children.length) { yield accSteps.concat([{ action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }]); return; }
                for (const seg of enumerate(children[idx], haveNow)) {
                    const haveNext = applyPersistentFromSteps(haveNow, seg);
                    yield* enumerateChildren(idx + 1, accSteps.concat(seg), haveNext);
                }
            }
            yield* enumerateChildren(0, [], have || new Set());
            return;
        }
        if (node.action === 'smelt') {
            if (node.operator === 'OR' && node.children && node.children.length > 0) { for (const child of node.children) yield* enumerate(child, have); return; }
            if (node.operator === 'AND' && node.children && node.children.length > 0) {
                function* enumerateChildren(idx, accSteps, haveNow) {
                    if (idx >= node.children.length) { yield accSteps.concat([{ action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }]); return; }
                    const child = node.children[idx];
                    const childReqName = child && child.action === 'require' ? requiredPersistentFromRequire(child) : null;
                    const skip = childReqName && haveNow && haveNow.has(childReqName);
                    if (skip) { yield* enumerateChildren(idx + 1, accSteps, haveNow); return; }
                    for (const seg of enumerate(child, haveNow)) {
                        const haveNext = applyPersistentFromSteps(haveNow, seg);
                        yield* enumerateChildren(idx + 1, accSteps.concat(seg), haveNext);
                    }
                }
                yield* enumerateChildren(0, [], have || new Set());
                return;
            }
            if (node.operator === 'AND' && (!node.children || node.children.length === 0)) { yield [{ action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }]; return; }
        }
        if ((node.action === 'mine' || node.action === 'hunt') && node.operator === 'OR' && node.children && node.children.length > 0) { for (const child of node.children) yield* enumerate(child, have); return; }
        if ((node.action === 'mine' || node.action === 'hunt') && (!node.children || node.children.length === 0)) { yield [{ action: node.action, what: node.what, count: node.count, dropChance: node.dropChance, tool: node.tool, targetItem: node.targetItem }]; return; }
    }

    const baseGen = enumerate(tree, persistentSetFromInventory(invObj));
    function makeLeafStream(step) { return function* () { yield { path: [step] }; }; }
    function makeOrStream(childStreams) { return function* () { for (const s of childStreams) for (const item of s()) yield item; }; }
    function makeAndStream(childStreams, parentStepOrNull) {
        return function* () {
            function* product(idx, acc) {
                if (idx >= childStreams.length) { const final = parentStepOrNull ? acc.concat([parentStepOrNull]) : acc; yield { path: final }; return; }
                for (const item of childStreams[idx]()) { yield* product(idx + 1, acc.concat(item.path)); }
            }
            yield* product(0, []);
        };
    }
    function makeStream(node) {
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
    }
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) { let cleaned = sanitizePath(item.path); if (!isPathValid(cleaned)) cleaned = item.path; if (isPathValid(cleaned)) yield cleaned; } })();
}

module.exports = { enumerateActionPathsGenerator };


