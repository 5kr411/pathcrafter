let pruneWithWorldEnabled = false;
let defaultPerGeneratorPaths = 50;
let defaultSnapshotChunkRadius = 3;
let planningTelemetryEnabled = false;
let safeFindRepeatThreshold = 3;

function setPruneWithWorldEnabled(v) { pruneWithWorldEnabled = !!v; }
function getPruneWithWorldEnabled() { return !!pruneWithWorldEnabled; }

function setDefaultPerGeneratorPaths(n) { if (Number.isFinite(n) && n > 0) defaultPerGeneratorPaths = Math.floor(n); }
function getDefaultPerGeneratorPaths() { return defaultPerGeneratorPaths; }

function setDefaultSnapshotChunkRadius(n) { if (Number.isFinite(n) && n >= 0 && n <= 8) defaultSnapshotChunkRadius = Math.floor(n); }
function getDefaultSnapshotChunkRadius() { return defaultSnapshotChunkRadius; }

module.exports = {
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


