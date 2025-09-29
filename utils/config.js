let genericWoodEnabled = true;
let pruneWithWorldEnabled = false;
let defaultPerGeneratorPaths = 50;
let defaultSnapshotChunkRadius = 3;
let planningTelemetryEnabled = false;
let safeFindRepeatThreshold = 3;

// Initialize from environment variable if provided (truthy/falsey parsing)
try {
    const raw = process.env && (process.env.MINEBOT_GENERIC_WOOD || process.env.GENERIC_WOOD);
    if (typeof raw === 'string') {
        const v = raw.trim().toLowerCase();
        if (v === '0' || v === 'false' || v === 'off' || v === 'no') genericWoodEnabled = false;
        if (v === '1' || v === 'true' || v === 'on' || v === 'yes') genericWoodEnabled = true;
    }
} catch (_) {}

function setGenericWoodEnabled(v) { genericWoodEnabled = !!v; }
function getGenericWoodEnabled() { return !!genericWoodEnabled; }

function setPruneWithWorldEnabled(v) { pruneWithWorldEnabled = !!v; }
function getPruneWithWorldEnabled() { return !!pruneWithWorldEnabled; }

function setDefaultPerGeneratorPaths(n) { if (Number.isFinite(n) && n > 0) defaultPerGeneratorPaths = Math.floor(n); }
function getDefaultPerGeneratorPaths() { return defaultPerGeneratorPaths; }

function setDefaultSnapshotChunkRadius(n) { if (Number.isFinite(n) && n >= 0 && n <= 8) defaultSnapshotChunkRadius = Math.floor(n); }
function getDefaultSnapshotChunkRadius() { return defaultSnapshotChunkRadius; }

module.exports = {
    setGenericWoodEnabled,
    getGenericWoodEnabled,
    setPruneWithWorldEnabled,
    getPruneWithWorldEnabled,
    setDefaultPerGeneratorPaths,
    getDefaultPerGeneratorPaths,
    setDefaultSnapshotChunkRadius,
    getDefaultSnapshotChunkRadius
    , setPlanningTelemetryEnabled: (v) => { planningTelemetryEnabled = !!v; }
    , getPlanningTelemetryEnabled: () => !!planningTelemetryEnabled
    , setSafeFindRepeatThreshold: (n) => { if (Number.isFinite(n) && n >= 1) safeFindRepeatThreshold = Math.floor(n); }
    , getSafeFindRepeatThreshold: () => safeFindRepeatThreshold
};


