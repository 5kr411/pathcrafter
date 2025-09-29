const fs = require('fs');
const path = require('path');
const minecraftData = require('minecraft-data');

/**
 * Capture a summarized snapshot of world data near the bot.
 * Instead of returning every block/entity position, aggregate by type with statistics:
 * { count, closestDistance, averageDistance } relative to the bot center.
 *
 * Options:
 * - radius: max Euclidean distance in blocks to scan (preferred)
 * - chunkRadius: legacy option; converted to radius via radius = chunkRadius*16 + 15
 * - includeAir: include air blocks (default false)
 * - yMin, yMax: vertical scan bounds (defaults to chunk min/max for the version if known, else [0, 255])
 * - version/mcData: override mcData resolution
 */
function captureRawWorldSnapshot(bot, opts = {}) {
    const version = bot && bot.version ? bot.version : (opts.version || '1.20.1');
    const mc = typeof opts.mcData === 'object' && opts.mcData ? opts.mcData : minecraftData(version);
    const includeAir = !!opts.includeAir;
    const legacyChunkRadius = Number.isFinite(opts.chunkRadius) ? Math.max(0, Math.min(opts.chunkRadius, 8)) : null;
    const explicitRadius = Number.isFinite(opts.radius) ? Math.max(1, Math.min(opts.radius, 1024)) : null;
    const maxDistance = explicitRadius != null
        ? explicitRadius
        : Math.max(1, Math.min((((legacyChunkRadius != null ? legacyChunkRadius : 2) * 16) + 15), 1024));

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
        radius: maxDistance,
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

// Async, non-blocking snapshotter that yields between distance shells to avoid long event-loop stalls
async function captureRawWorldSnapshotAsync(bot, opts = {}) {
    const version = bot && bot.version ? bot.version : (opts.version || '1.20.1');
    const mc = typeof opts.mcData === 'object' && opts.mcData ? opts.mcData : minecraftData(version);
    const includeAir = !!opts.includeAir;
    const legacyChunkRadius = Number.isFinite(opts.chunkRadius) ? Math.max(0, Math.min(opts.chunkRadius, 8)) : null;
    const explicitRadius = Number.isFinite(opts.radius) ? Math.max(1, Math.min(opts.radius, 1024)) : null;
    const maxRadius = explicitRadius != null
        ? explicitRadius
        : Math.max(1, Math.min((((legacyChunkRadius != null ? legacyChunkRadius : 2) * 16) + 15), 1024));

    const center = bot && bot.entity && bot.entity.position ? bot.entity.position.floored() : { x: 0, y: 64, z: 0 };
    const cx = center.x || 0;
    const cy = center.y || 64;
    const cz = center.z || 0;

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

    function dist(ax, ay, az, bx, by, bz) {
        const dx = ax - bx; const dy = ay - by; const dz = az - bz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    const seen = new Set();
    const blockAgg = new Map();

    const step = Math.max(32, Math.min(96, Math.floor(maxRadius / 4) || 32));
    for (let r = step; r <= maxRadius + 1; r += step) {
        const shellMax = Math.min(r, maxRadius);
        const positions = (bot && typeof bot.findBlocks === 'function')
            ? bot.findBlocks({ matching, maxDistance: shellMax, count: maxCount })
            : [];
        for (const pos of positions) {
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const blk = bot.blockAt(pos, false);
            if (!blk) continue;
            if (!includeAir && blk.name === 'air') continue;
            const name = blk.name; if (!name) continue;
            const d = dist(cx, cy, cz, pos.x, pos.y, pos.z);
            if (d > maxRadius) continue;
            const rec = blockAgg.get(name) || { count: 0, sumDist: 0, closest: Infinity };
            rec.count += 1;
            rec.sumDist += d;
            if (d < rec.closest) rec.closest = d;
            blockAgg.set(name, rec);
        }
        await new Promise(resolve => setImmediate(resolve));
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

    // Entities are inexpensive; do once
    const entityAgg = new Map();
    if (bot && bot.entities) {
        for (const key in bot.entities) {
            const e = bot.entities[key];
            if (!e || !e.position) continue;
            const n = e.name || e.type || e.kind; if (!n) continue;
            const d = dist(cx, cy, cz, e.position.x, e.position.y, e.position.z);
            const rec = entityAgg.get(n) || { count: 0, sumDist: 0, closest: Infinity };
            rec.count += 1; rec.sumDist += d; if (d < rec.closest) rec.closest = d;
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
        radius: maxRadius,
        yMin,
        yMax,
        blocks: blockStats,
        entities: entityStats
    };
}

// Incremental snapshotting state machine (time-sliced)
function beginSnapshotScan(bot, opts = {}) {
    const version = bot && bot.version ? bot.version : (opts.version || '1.20.1');
    const mc = typeof opts.mcData === 'object' && opts.mcData ? opts.mcData : minecraftData(version);
    const includeAir = !!opts.includeAir;
    const legacyChunkRadius = Number.isFinite(opts.chunkRadius) ? Math.max(0, Math.min(opts.chunkRadius, 8)) : null;
    const explicitRadius = Number.isFinite(opts.radius) ? Math.max(1, Math.min(opts.radius, 1024)) : null;
    const maxRadius = explicitRadius != null
        ? explicitRadius
        : Math.max(1, Math.min((((legacyChunkRadius != null ? legacyChunkRadius : 2) * 16) + 15), 1024));
    const center = bot && bot.entity && bot.entity.position ? bot.entity.position.floored() : { x: 0, y: 64, z: 0 };
    const cx = center.x || 0;
    const cy = center.y || 64;
    const cz = center.z || 0;
    const defaultYMax = typeof mc?.features?.yMax === 'number' ? mc.features.yMax : 255;
    const defaultYMin = typeof mc?.features?.yMin === 'number' ? mc.features.yMin : 0;
    const yMin = Number.isFinite(opts.yMin) ? opts.yMin : defaultYMin;
    const yMax = Number.isFinite(opts.yMax) ? opts.yMax : defaultYMax;
    const step = Math.max(32, Math.min(96, Math.floor(maxRadius / 4) || 32));
    return {
        bot, mc, includeAir,
        center: { cx, cy, cz },
        maxRadius, yMin, yMax,
        step, r: step,
        seen: new Set(),
        blockAgg: new Map(),
        done: false
    };
}

function snapshotFromState(st) {
    const blockStats = {};
    for (const [name, rec] of st.blockAgg.entries()) {
        const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
        blockStats[name] = { count: rec.count, closestDistance: rec.closest === Infinity ? null : rec.closest, averageDistance: avg };
    }
    const entityStats = {};
    if (st.bot && st.bot.entities) {
        const dist = (ax, ay, az, bx, by, bz) => { const dx = ax - bx, dy = ay - by, dz = az - bz; return Math.sqrt(dx*dx + dy*dy + dz*dz) };
        for (const key in st.bot.entities) {
            const e = st.bot.entities[key]; if (!e || !e.position) continue;
            const n = e.name || e.type || e.kind; if (!n) continue;
            const d = dist(st.center.cx, st.center.cy, st.center.cz, e.position.x, e.position.y, e.position.z);
            const rec = entityStats[n] || { count: 0, sumDist: 0, closestDistance: null, averageDistance: 0 };
            if (!entityStats[n]) { entityStats[n] = rec }
            rec.count += 1; rec.sumDist += d; if (rec.closestDistance == null || d < rec.closestDistance) rec.closestDistance = d; rec.averageDistance = rec.sumDist / rec.count;
        }
    }
    return {
        version: st.bot && st.bot.version ? st.bot.version : '1.20.1',
        dimension: st.bot && st.bot.game && st.bot.game.dimension ? st.bot.game.dimension : 'overworld',
        center: { x: st.center.cx, y: st.center.cy, z: st.center.cz },
        radius: st.maxRadius,
        yMin: st.yMin,
        yMax: st.yMax,
        blocks: blockStats,
        entities: entityStats
    };
}

async function stepSnapshotScan(st, budgetMs = 20) {
    const t0 = Date.now();
    if (st.done) return true;
    const matching = (b) => {
        if (!b) return false;
        if (!st.includeAir && b.name === 'air') return false;
        const y = b.position?.y; if (typeof y === 'number') { if (y < st.yMin || y > st.yMax) return false; }
        return true;
    };
    const dist = (ax, ay, az, bx, by, bz) => { const dx = ax - bx, dy = ay - by, dz = az - bz; return Math.sqrt(dx*dx + dy*dy + dz*dz) };
    while (Date.now() - t0 < budgetMs) {
        const r = Math.min(st.r, st.maxRadius);
        const positions = (st.bot && typeof st.bot.findBlocks === 'function')
            ? st.bot.findBlocks({ matching, maxDistance: r, count: 2147483647 })
            : [];
        for (const pos of positions) {
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (st.seen.has(key)) continue;
            st.seen.add(key);
            const blk = st.bot.blockAt(pos, false); if (!blk) continue;
            if (!st.includeAir && blk.name === 'air') continue;
            const name = blk.name; if (!name) continue;
            const d = dist(st.center.cx, st.center.cy, st.center.cz, pos.x, pos.y, pos.z);
            if (d > st.maxRadius) continue;
            const rec = st.blockAgg.get(name) || { count: 0, sumDist: 0, closest: Infinity };
            rec.count += 1; rec.sumDist += d; if (d < rec.closest) rec.closest = d;
            st.blockAgg.set(name, rec);
        }
        if (st.r >= st.maxRadius) { st.done = true; break; }
        st.r += st.step;
        await new Promise(resolve => setImmediate(resolve));
        if (Date.now() - t0 >= budgetMs) break;
    }
    return st.done;
}

module.exports = {
    captureRawWorldSnapshot,
    captureRawWorldSnapshotAsync,
    beginSnapshotScan,
    stepSnapshotScan,
    snapshotFromState,
    saveSnapshotToFile,
    loadSnapshotFromFile
};


