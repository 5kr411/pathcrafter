const fs = require('fs');
const path = require('path');
const minecraftData = require('minecraft-data');

/**
 * Capture a raw snapshot of world data by scanning blocks within a radius and listing entities.
 * This enumerates positions and block state for all matching blocks (optionally including air).
 *
 * Options:
 * - radius: scan radius from bot position (default 96, clamped to [8, 512])
 * - includeAir: include air blocks (default false)
 * - yMin, yMax: vertical scan bounds (defaults to chunk min/max for the version if known, else [0, 255])
 * - version/mcData: override mcData resolution
 */
function captureRawWorldSnapshot(bot, opts = {}) {
    const version = bot && bot.version ? bot.version : (opts.version || '1.20.1');
    const mc = typeof opts.mcData === 'object' && opts.mcData ? opts.mcData : minecraftData(version);
    const includeAir = !!opts.includeAir;
    const chunkRadius = Math.max(0, Math.min((opts.chunkRadius || 2), 8));
    const maxDistance = Math.max(1, Math.min(((chunkRadius * 16) + 15), 1024));

    const center = bot && bot.entity && bot.entity.position ? bot.entity.position.floored() : { x: 0, y: 64, z: 0 };
    const cx = center.x || 0;
    const cy = center.y || 64;
    const cz = center.z || 0;

    // Determine Y bounds
    const defaultYMax = typeof mc?.features?.yMax === 'number' ? mc.features.yMax : 255;
    const defaultYMin = typeof mc?.features?.yMin === 'number' ? mc.features.yMin : 0;
    const yMin = Number.isFinite(opts.yMin) ? opts.yMin : defaultYMin;
    const yMax = Number.isFinite(opts.yMax) ? opts.yMax : defaultYMax;

    const maxCount = 2147483647;
    const matching = (b) => {
        if (!b) return false;
        if (!includeAir && b.name === 'air') return false;
        const y = b.position?.y;
        if (typeof y === 'number') {
            if (y < yMin || y > yMax) return false;
        }
        return true;
    };

    // Collect positions of all blocks within radius that match predicate
    const positions = (bot && typeof bot.findBlocks === 'function')
        ? bot.findBlocks({ matching, maxDistance, count: maxCount })
        : [];

    // Materialize block data
    const blocks = [];
    for (const pos of positions) {
        const blk = bot.blockAt(pos, false);
        if (!blk) continue;
        if (!includeAir && blk.name === 'air') continue;
        const base = {
            x: blk.position.x,
            y: blk.position.y,
            z: blk.position.z,
            name: blk.name,
            id: typeof blk.type === 'number' ? blk.type : undefined,
            stateId: typeof blk.stateId === 'number' ? blk.stateId : undefined
        };
        // Try to include block properties if available
        try {
            if (typeof blk.getProperties === 'function') {
                const props = blk.getProperties();
                if (props && typeof props === 'object') base.properties = props;
            }
        } catch (_) {}
        blocks.push(base);
    }

    // Entities with basic fields
    const entities = [];
    if (bot && bot.entities) {
        for (const key in bot.entities) {
            const e = bot.entities[key];
            if (!e || !e.position) continue;
            entities.push({
                id: e.id,
                name: e.name,
                type: e.type,
                kind: e.kind,
                position: { x: e.position.x, y: e.position.y, z: e.position.z }
            });
        }
    }

    return {
        version,
        dimension: bot && bot.game && bot.game.dimension ? bot.game.dimension : 'overworld',
        center: { x: cx, y: cy, z: cz },
        chunkRadius,
        yMin,
        yMax,
        blocks,
        entities
    };
}

function saveSnapshotToFile(snapshot, filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

function loadSnapshotFromFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}

module.exports = {
    captureRawWorldSnapshot,
    saveSnapshotToFile,
    loadSnapshotFromFile
};


