function collectFirstN(iterator, n) {
    const out = [];
    const it = iterator[Symbol.iterator]();
    while (out.length < n) {
        const { value, done } = it.next();
        if (done) break;
        out.push(value);
    }
    return out;
}

module.exports = { collectFirstN };


