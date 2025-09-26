const { getLastMcData } = require('../utils/context');
const { getSuffixTokenFromName } = require('../utils/items');
const { getSmeltsPerUnitForFuel } = require('../utils/smeltingConfig');

function enumerateActionPathsGenerator(tree, options = {}) {
    const invObj = options && options.inventory && typeof options.inventory === 'object' ? options.inventory : null;

    const { buildPersistentNamesSet, isPersistentItemName } = require('../utils/persistence');
    const persistentNames = buildPersistentNamesSet();
    function isPersistentItemNameLocal(name) { return isPersistentItemName(name, persistentNames); }

    const { makeSupplyFromInventory } = require('../utils/inventory');
    const initialSupply = makeSupplyFromInventory(invObj);

    const { isPathValidBasic } = require('../utils/pathValidation');
    function isPathValid(path) { return isPathValidBasic(path, initialSupply, getSmeltsPerUnitForFuel); }

    const { sanitizePath: sanitizePathShared } = require('../utils/sanitizer');
    function sanitizePath(path) {
        return sanitizePathShared(path, {
            isPersistentName: isPersistentItemNameLocal,
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


