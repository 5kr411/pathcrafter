const { getLastMcData } = require('../utils/context');
const { getSuffixTokenFromName } = require('../utils/items');
const { createEnumeratorContext } = require('../utils/enumeratorFactory');

function enumerateActionPathsGenerator(tree, options = {}) {
    const ctx = createEnumeratorContext(options, 'basic');

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
    const makeStream = ctx.createMakeStream(makeLeafStream, makeOrStream, makeAndStream);
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) { let cleaned = ctx.sanitizePath(item.path); if (!ctx.isPathValid(cleaned)) cleaned = item.path; if (ctx.isPathValid(cleaned)) yield cleaned; } })();
}

module.exports = { enumerateActionPathsGenerator };




