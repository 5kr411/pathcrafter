let lastMcData = null;
let woodSpeciesTokens = null;
let currentSpeciesContext = null;
let targetItemNameGlobal = null;

function setLastMcData(v) { lastMcData = v; }
function getLastMcData() { return lastMcData; }

function setWoodSpeciesTokens(v) { woodSpeciesTokens = v; }
function getWoodSpeciesTokens() { return woodSpeciesTokens; }

function setCurrentSpeciesContext(v) { currentSpeciesContext = v; }
function getCurrentSpeciesContext() { return currentSpeciesContext; }

function setTargetItemNameGlobal(v) { targetItemNameGlobal = v; }
function getTargetItemNameGlobal() { return targetItemNameGlobal; }

module.exports = {
    setLastMcData,
    getLastMcData,
    setWoodSpeciesTokens,
    getWoodSpeciesTokens,
    setCurrentSpeciesContext,
    getCurrentSpeciesContext,
    setTargetItemNameGlobal,
    getTargetItemNameGlobal
};


