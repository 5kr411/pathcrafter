// Centralized smelting mappings and fuel characteristics

// Map output item -> array of valid input items for furnace smelting
const FURNACE_INPUTS = {
    // Minimal seed: iron only (extend as needed)
    iron_ingot: ['raw_iron', 'iron_ore', 'deepslate_iron_ore'],
    gold_ingot: ['raw_gold', 'gold_ore', 'deepslate_gold_ore'],
    copper_ingot: ['raw_copper', 'copper_ore', 'deepslate_copper_ore'],
    stone: ['cobblestone'],
};

// Fuel configuration: itemName -> smeltsPerUnit (Java baseline)
// Only coal required now; add more fuels as domain expands
const FUEL_SMELTS_PER_UNIT = {
    coal: 8
    // charcoal: 8,
    // blaze_rod: 12,
    // stick: 0.5,
    // bamboo: 0.25,
    // ...
};

function getFurnaceInputsFor(outputItemName) {
    return FURNACE_INPUTS[outputItemName] || [];
}

function chooseMinimalFuelName(mcData) {
    // For now, prefer coal if available; else return null to avoid fuel branch
    return mcData.itemsByName['coal'] ? 'coal' : null;
}

function getSmeltsPerUnitForFuel(fuelName) {
    return FUEL_SMELTS_PER_UNIT[fuelName] || 0;
}

module.exports = {
    getFurnaceInputsFor,
    chooseMinimalFuelName,
    getSmeltsPerUnitForFuel
};


