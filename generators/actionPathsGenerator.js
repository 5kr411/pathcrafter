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

    const { sanitizePath: sanitizePathShared } = require('../utils/sanitizer');
    function sanitizePath(path) {
        return sanitizePathShared(path, {
            isPersistentName: isPersistentItemName,
            isPathValid,
            getSmeltsPerUnitForFuel
        });
    }

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
    const { createMakeStream } = require('../utils/streamFactory');
    const makeStream = createMakeStream(makeLeafStream, makeOrStream, makeAndStream);
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) { let cleaned = sanitizePath(item.path); if (!isPathValid(cleaned)) cleaned = item.path; if (isPathValid(cleaned)) yield cleaned; } })();
}

module.exports = { enumerateActionPathsGenerator };


