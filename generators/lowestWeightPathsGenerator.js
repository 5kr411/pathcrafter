const { getLastMcData } = require('../utils/context');
const { getSuffixTokenFromName } = require('../utils/items');
const { computePathWeight } = require('../utils/pathUtils');
const { getSmeltsPerUnitForFuel } = require('../smeltingConfig');

function enumerateLowestWeightPathsGenerator(tree, options = {}) {
    const invObj = options && options.inventory && typeof options.inventory === 'object' ? options.inventory : null;
    function MinHeap(compare) { this.compare = compare; this.data = []; }
    MinHeap.prototype.push = function (item) { const a = this.data; a.push(item); let i = a.length - 1; while (i > 0) { const p = Math.floor((i - 1) / 2); if (this.compare(a[i], a[p]) >= 0) break; const t = a[i]; a[i] = a[p]; a[p] = t; i = p; } };
    MinHeap.prototype.pop = function () { const a = this.data; if (a.length === 0) return undefined; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; while (true) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < a.length && this.compare(a[l], a[s]) < 0) s = l; if (r < a.length && this.compare(a[r], a[s]) < 0) s = r; if (s === i) break; const t = a[i]; a[i] = a[s]; a[s] = t; i = s; } } return top; };
    MinHeap.prototype.size = function () { return this.data.length; };

    const { stepWeight } = require('../utils/pathUtils');

    function makeLeafStream(step) { const w = stepWeight(step); return function* () { yield { path: [step], weight: w }; }; }

    const { buildPersistentNamesSet, isPersistentItemName } = require('../utils/persistence');
    const persistentNames = buildPersistentNamesSet();
    const { makeSupplyFromInventory } = require('../utils/inventory');
    const initialSupply = makeSupplyFromInventory(invObj);

    const { dedupePersistentAcquisitions } = require('../utils/sanitizer');
    function sanitizePath(path) { return dedupePersistentAcquisitions(path, name => isPersistentItemName(name, persistentNames)); }

    const { isPathValidBasic } = require('../utils/pathValidation');
    function isPathValid(path) { return isPathValidBasic(path, initialSupply, getSmeltsPerUnitForFuel); }

    function makeOrStream(childStreams) {
        return function* () {
            const heap = new MinHeap((a, b) => a.item.weight - b.item.weight);
            const gens = childStreams.map(s => s());
            gens.forEach((g, idx) => { const n = g.next(); if (!n.done) heap.push({ idx, gen: g, item: n.value }); });
            while (heap.size() > 0) { const { idx, gen, item } = heap.pop(); yield item; const n = gen.next(); if (!n.done) heap.push({ idx, gen, item: n.value }); }
        };
    }

    function makeAndStream(childStreams, parentStepOrNull) {
        return function* () {
            const streams = childStreams.map(s => ({ gen: s(), buf: [], done: false }));
            function ensure(i, j) { const st = streams[i]; while (!st.done && st.buf.length <= j) { const n = st.gen.next(); if (n.done) { st.done = true; break; } st.buf.push(n.value); } return st.buf.length > j; }
            for (let i = 0; i < streams.length; i++) { if (!ensure(i, 0)) return; }
            const heap = new MinHeap((a, b) => a.weight - b.weight);
            const visited = new Set();
            const initIdx = new Array(streams.length).fill(0);
            function idxKey(idxArr) { return idxArr.join(','); }
            function sumWeight(idxArr) { let s = 0; for (let i = 0; i < idxArr.length; i++) s += streams[i].buf[idxArr[i]].weight; if (parentStepOrNull) s += stepWeight(parentStepOrNull); return s; }
            heap.push({ idx: initIdx, weight: sumWeight(initIdx) }); visited.add(idxKey(initIdx));
            while (heap.size() > 0) {
                const node = heap.pop();
                const parts = []; for (let i = 0; i < node.idx.length; i++) parts.push(streams[i].buf[node.idx[i]].path);
                let combined = parts.flat(); if (parentStepOrNull) combined = combined.concat([parentStepOrNull]);
                let cleaned = sanitizePath(combined);
                if (!isPathValid(cleaned)) cleaned = combined;
                if (isPathValid(cleaned)) { yield { path: cleaned, weight: computePathWeight(cleaned) }; }
                for (let d = 0; d < streams.length; d++) {
                    const nextIdx = node.idx.slice(); nextIdx[d] += 1; if (!ensure(d, nextIdx[d])) continue; const k = idxKey(nextIdx); if (visited.has(k)) continue; visited.add(k); heap.push({ idx: nextIdx, weight: sumWeight(nextIdx) });
                }
            }
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
        if (node.action === 'smelt') { if (node.operator === 'OR') return makeOrStream((node.children || []).map(makeStream)); const step = { action: 'smelt', what: 'furnace', count: node.count, input: node.input, result: node.result, fuel: node.fuel }; return makeAndStream((node.children || []).map(makeStream), step); }
        if (node.action === 'mine' || node.action === 'hunt') { if (node.operator === 'OR') return makeOrStream((node.children || []).map(makeStream)); }
        if (node.action === 'require') { return makeAndStream((node.children || []).map(makeStream), null); }
        if (node.action === 'craft') { const step = { action: 'craft', what: node.what, count: node.count, result: node.result, ingredients: node.ingredients }; return makeAndStream((node.children || []).map(makeStream), step); }
        return makeOrStream((node.children || []).map(makeStream));
    }
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) yield item.path; })();
}

module.exports = { enumerateLowestWeightPathsGenerator };


