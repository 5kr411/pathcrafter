function createEnumeratorContext(options = {}, validation = 'basic') {
    const invObj = options && options.inventory && typeof options.inventory === 'object' ? options.inventory : null;

    const { buildPersistentNamesSet, isPersistentItemName } = require('./persistence');
    const persistentNames = buildPersistentNamesSet();
    function isPersistentItemNameLocal(name) { return isPersistentItemName(name, persistentNames); }

    const { makeSupplyFromInventory } = require('./inventory');
    const initialSupply = makeSupplyFromInventory(invObj);

    const { getSmeltsPerUnitForFuel } = require('./smeltingConfig');
    const {
        isPathValidBasic,
        isPathComposableBasic,
        isPathComposableWithFamilies,
        isPathValidWithFamilies
    } = require('./pathValidation');

    function selectValidator(kind) {
        if (kind === 'basic') return (path) => isPathValidBasic(path, initialSupply, getSmeltsPerUnitForFuel);
        if (kind === 'composableBasic') return (path) => isPathComposableBasic(path, initialSupply, getSmeltsPerUnitForFuel);
        if (kind === 'composableWithFamilies') return (path) => isPathComposableWithFamilies(path, initialSupply, getSmeltsPerUnitForFuel);
        if (kind === 'validWithFamilies') return (path) => isPathValidWithFamilies(path, initialSupply, getSmeltsPerUnitForFuel);
        return (path) => isPathValidBasic(path, initialSupply, getSmeltsPerUnitForFuel);
    }

    const isPathValid = selectValidator(validation);

    const { sanitizePath: sanitizePathShared } = require('./sanitizer');
    function sanitizePath(path) {
        return sanitizePathShared(path, {
            isPersistentName: isPersistentItemNameLocal,
            isPathValid,
            getSmeltsPerUnitForFuel
        });
    }

    const { createMakeStream } = require('./streamFactory');

    return {
        invObj,
        initialSupply,
        isPersistentItemName: isPersistentItemNameLocal,
        isPathValid,
        sanitizePath,
        createMakeStream
    };
}

module.exports = { createEnumeratorContext };


