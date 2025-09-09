function MinHeap(compare) {
    this.compare = compare;
    this.data = [];
}
MinHeap.prototype.push = function (item) {
    const a = this.data;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
        const p = Math.floor((i - 1) / 2);
        if (this.compare(a[i], a[p]) >= 0) break;
        const t = a[i]; a[i] = a[p]; a[p] = t; i = p;
    }
};
MinHeap.prototype.pop = function () {
    const a = this.data;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
        a[0] = last;
        let i = 0;
        while (true) {
            const l = 2 * i + 1, r = l + 1;
            let s = i;
            if (l < a.length && this.compare(a[l], a[s]) < 0) s = l;
            if (r < a.length && this.compare(a[r], a[s]) < 0) s = r;
            if (s === i) break;
            const t = a[i]; a[i] = a[s]; a[s] = t; i = s;
        }
    }
    return top;
};
MinHeap.prototype.size = function () { return this.data.length; };

function createPriorityStreams(cfg) {
    const getItemScore = typeof cfg.getItemScore === 'function' ? cfg.getItemScore : (x) => 0;
    const getParentStepScore = typeof cfg.getParentStepScore === 'function' ? cfg.getParentStepScore : () => 0;
    const sanitizePath = typeof cfg.sanitizePath === 'function' ? cfg.sanitizePath : (p) => p;
    const isPathValid = typeof cfg.isPathValid === 'function' ? cfg.isPathValid : () => true;
    const finalizeItem = typeof cfg.finalizeItem === 'function' ? cfg.finalizeItem : (p) => ({ path: p });

    function makeOrStream(childStreams) {
        return function* () {
            const heap = new MinHeap((a, b) => getItemScore(a.item) - getItemScore(b.item));
            const gens = childStreams.map((s) => s());
            gens.forEach((g, idx) => { const n = g.next(); if (!n.done) heap.push({ idx, gen: g, item: n.value }); });
            while (heap.size() > 0) {
                const { idx, gen, item } = heap.pop();
                yield item;
                const n = gen.next();
                if (!n.done) heap.push({ idx, gen, item: n.value });
            }
        };
    }

    function makeAndStream(childStreams, parentStepOrNull) {
        return function* () {
            const streams = childStreams.map((s) => ({ gen: s(), buf: [], done: false }));
            function ensure(i, j) {
                const st = streams[i];
                while (!st.done && st.buf.length <= j) {
                    const n = st.gen.next();
                    if (n.done) { st.done = true; break; }
                    st.buf.push(n.value);
                }
                return st.buf.length > j;
            }
            for (let i = 0; i < streams.length; i++) { if (!ensure(i, 0)) return; }
            const heap = new MinHeap((a, b) => a.score - b.score);
            const visited = new Set();
            const initIdx = new Array(streams.length).fill(0);
            function idxKey(idxArr) { return idxArr.join(','); }
            function sumScore(idxArr) {
                let s = 0;
                for (let i = 0; i < idxArr.length; i++) s += getItemScore(streams[i].buf[idxArr[i]]);
                s += getParentStepScore(parentStepOrNull);
                return s;
            }
            heap.push({ idx: initIdx, score: sumScore(initIdx) });
            visited.add(idxKey(initIdx));
            while (heap.size() > 0) {
                const node = heap.pop();
                const parts = [];
                for (let i = 0; i < node.idx.length; i++) parts.push(streams[i].buf[node.idx[i]].path);
                let combined = parts.flat();
                if (parentStepOrNull) combined = combined.concat([parentStepOrNull]);

                let cleaned = sanitizePath(combined);
                if (!isPathValid(cleaned)) cleaned = combined;
                if (isPathValid(cleaned)) { yield finalizeItem(cleaned); }

                for (let d = 0; d < streams.length; d++) {
                    const nextIdx = node.idx.slice();
                    nextIdx[d] += 1;
                    if (!ensure(d, nextIdx[d])) continue;
                    const k = idxKey(nextIdx);
                    if (visited.has(k)) continue;
                    visited.add(k);
                    heap.push({ idx: nextIdx, score: sumScore(nextIdx) });
                }
            }
        };
    }

    return { makeOrStream, makeAndStream };
}

module.exports = { createPriorityStreams };


