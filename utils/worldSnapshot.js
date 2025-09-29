const fs = require('fs');
const path = require('path');
const minecraftData = require('minecraft-data');

/**
 * Capture a summarized snapshot of world data near the bot.
 * Instead of returning every block/entity position, aggregate by type with statistics:
 * { count, closestDistance, averageDistance } relative to the bot center.
 *
 * Options:
 * - chunkRadius: chunk radius to scan (default 2, clamped to [0, 8])
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

    function dist(ax, ay, az, bx, by, bz) {
        const dx = ax - bx; const dy = ay - by; const dz = az - bz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // Aggregate block statistics by name
    const blockAgg = new Map(); // name -> { count, sumDist, closest }
    for (const pos of positions) {
        const blk = bot.blockAt(pos, false);
        if (!blk) continue;
        if (!includeAir && blk.name === 'air') continue;
        const name = blk.name;
        if (!name) continue;
        const d = dist(cx, cy, cz, pos.x, pos.y, pos.z);
        const rec = blockAgg.get(name) || { count: 0, sumDist: 0, closest: Infinity };
        rec.count += 1;
        rec.sumDist += d;
        if (d < rec.closest) rec.closest = d;
        blockAgg.set(name, rec);
    }

    const blockStats = {};
    for (const [name, rec] of blockAgg.entries()) {
        const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
        blockStats[name] = {
            count: rec.count,
            closestDistance: rec.closest === Infinity ? null : rec.closest,
            averageDistance: avg
        };
    }

    // Aggregate entity statistics by preferred name
    const entityAgg = new Map(); // name -> { count, sumDist, closest }
    if (bot && bot.entities) {
        for (const key in bot.entities) {
            const e = bot.entities[key];
            if (!e || !e.position) continue;
            const n = e.name || e.type || e.kind;
            if (!n) continue;
            const d = dist(cx, cy, cz, e.position.x, e.position.y, e.position.z);
            const rec = entityAgg.get(n) || { count: 0, sumDist: 0, closest: Infinity };
            rec.count += 1;
            rec.sumDist += d;
            if (d < rec.closest) rec.closest = d;
            entityAgg.set(n, rec);
        }
    }

    const entityStats = {};
    for (const [name, rec] of entityAgg.entries()) {
        const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
        entityStats[name] = {
            count: rec.count,
            closestDistance: rec.closest === Infinity ? null : rec.closest,
            averageDistance: avg
        };
    }

    return {
        version,
        dimension: bot && bot.game && bot.game.dimension ? bot.game.dimension : 'overworld',
        center: { x: cx, y: cy, z: cz },
        chunkRadius,
        yMin,
        yMax,
        blocks: blockStats,
        entities: entityStats
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


