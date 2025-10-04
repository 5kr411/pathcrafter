export function collectFirstN<T>(iterator: Iterable<T>, n: number): T[] {
    const out: T[] = [];
    const it = iterator[Symbol.iterator]();
    while (out.length < n) {
        const { value, done } = it.next();
        if (done) break;
        out.push(value);
    }
    return out;
}

