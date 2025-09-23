const { computePathWeight } = require('../utils/pathUtils');
const { getSmeltsPerUnitForFuel } = require('../utils/smeltingConfig');

function enumerateLowestWeightPathsGenerator(tree, options = {}) {
    const invObj = options && options.inventory && typeof options.inventory === 'object' ? options.inventory : null;

    const { stepWeight } = require('../utils/pathUtils');

    function makeLeafStream(step) { const w = stepWeight(step); return function* () { yield { path: [step], weight: w }; }; }

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

    const { isPathComposableBasic } = require('../utils/pathValidation');
    function isPathValid(path) { return isPathComposableBasic(path, initialSupply, getSmeltsPerUnitForFuel); }

    const { createPriorityStreams } = require('../utils/priorityStreams');
    const { makeOrStream, makeAndStream } = createPriorityStreams({
        getItemScore: (item) => item.weight,
        getParentStepScore: (step) => (step ? stepWeight(step) : 0),
        sanitizePath,
        isPathValid,
        finalizeItem: (cleaned) => ({ path: cleaned, weight: computePathWeight(cleaned) })
    });

    const { createMakeStream } = require('../utils/streamFactory');
    const makeStream = createMakeStream(makeLeafStream, makeOrStream, makeAndStream);
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) yield item.path; })();
}

module.exports = { enumerateLowestWeightPathsGenerator };



