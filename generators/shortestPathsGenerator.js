const { getSmeltsPerUnitForFuel } = require('../utils/smeltingConfig');

function enumerateShortestPathsGenerator(tree, options = {}) {
    const invObj = options && options.inventory && typeof options.inventory === 'object' ? options.inventory : null;

    function makeLeafStream(step) { return function* () { yield { path: [step], length: 1 }; }; }

    const { buildPersistentNamesSet, isPersistentItemName } = require('../utils/persistence');
    const persistentNames = buildPersistentNamesSet();
    const { makeSupplyFromInventory } = require('../utils/inventory');
    const initialSupply = makeSupplyFromInventory(invObj);

    const { sanitizePath: sanitizePathShared } = require('../utils/sanitizer');
    function sanitizePath(path) {
        return sanitizePathShared(path, {
            isPersistentName: name => isPersistentItemName(name, persistentNames)
        });
    }

    const { isPathValidWithFamilies } = require('../utils/pathValidation');
    function isPathValid(path) { return isPathValidWithFamilies(path, initialSupply, getSmeltsPerUnitForFuel); }

    const { createPriorityStreams } = require('../utils/priorityStreams');
    const { makeOrStream, makeAndStream } = createPriorityStreams({
        getItemScore: (item) => item.length,
        getParentStepScore: (step) => (step ? 1 : 0),
        sanitizePath,
        isPathValid,
        finalizeItem: (cleaned) => ({ path: cleaned, length: cleaned.length })
    });

    const { createMakeStream } = require('../utils/streamFactory');
    const makeStream = createMakeStream(makeLeafStream, makeOrStream, makeAndStream);
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) yield item.path; })();
}

module.exports = { enumerateShortestPathsGenerator };


