const { getGenericWoodEnabled } = require('./config')
const { getWoodSpeciesTokens, getCurrentSpeciesContext } = require('./context')

function resolveGenericName(bot, mcData, name, opts = {}) {
  try {
    if (!getGenericWoodEnabled()) return name
    if (!name || typeof name !== 'string') return name
    if (!name.startsWith('generic_')) return name

    const base = name.slice('generic_'.length)
    const speciesTokens = buildSpeciesCandidates(mcData, getWoodSpeciesTokens())
    if (!speciesTokens || speciesTokens.length === 0) return name

    // 1) Prefer inventory species
    const items = bot?.inventory?.items?.() || []
    let bestSpecies = null
    let bestCount = 0
    for (const s of speciesTokens) {
      const candidate = `${s}_${base}`
      let c = 0
      for (const it of items) { if (it && it.name === candidate) c += it.count || 0 }
      if (c > bestCount) { bestCount = c; bestSpecies = s }
    }
    if (bestSpecies && bestCount > 0) return `${bestSpecies}_${base}`

    // 2) Context species from planner
    const ctx = getCurrentSpeciesContext()
    if (ctx) return `${ctx}_${base}`

    // 3) Prefer nearest in world by looking for logs (proxy for tree presence) or exact base
    const near = pickNearestSpeciesInWorld(bot, speciesTokens, base, mcData, { radius: opts.radius ?? 48 })
    if (near) return `${near}_${base}`

    // 4) Default to oak if present
    if (mcData.itemsByName[`oak_${base}`]) return `oak_${base}`

    return name
  } catch (_) { return name }
}

function pickNearestSpeciesInWorld(bot, speciesTokens, base, mcData, opts) {
  try {
    if (!bot || typeof bot.findBlocks !== 'function') return null
    const radius = Math.max(8, Math.min(opts?.radius || 48, 128))
    let best = null
    let bestDist2 = Infinity
    const center = bot.entity?.position
    function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx*dx + dy*dy + dz*dz }

    // Prefer logs as clear family indicator
    for (const s of speciesTokens) {
      const logName = `${s}_log`
      const positions = bot.findBlocks({ matching: (b) => b && b.name === logName, maxDistance: radius, count: 32 })
      for (const p of positions) {
        const d2 = center ? dist2(center, p) : 0
        if (d2 < bestDist2) { bestDist2 = d2; best = s }
      }
    }
    if (best) return best

    // Fallback: any block matching species base
    for (const s of speciesTokens) {
      const n = `${s}_${base}`
      const positions = bot.findBlocks({ matching: (b) => b && b.name === n, maxDistance: radius, count: 32 })
      for (const p of positions) {
        const d2 = center ? dist2(center, p) : 0
        if (d2 < bestDist2) { bestDist2 = d2; best = s }
      }
    }
    return best
  } catch (_) { return null }
}

module.exports = { resolveGenericName }

// Extended flexible resolver: accepts either generic_* or species-specific wood names
function resolveWoodFlexibleName(bot, mcData, name, opts = {}) {
  try {
    if (!getGenericWoodEnabled()) return name
    if (!name || typeof name !== 'string') return name
    if (name.startsWith('generic_')) return resolveGenericName(bot, mcData, name, opts)

    const idx = name.lastIndexOf('_')
    if (idx <= 0) return name
    const prefix = name.slice(0, idx)
    const base = name.slice(idx + 1)
    // Map any species-specific wood name to best available species for this base
    const resolved = resolveGenericName(bot, mcData, `generic_${base}`, opts)
    return resolved.startsWith('generic_') ? name : resolved
  } catch (_) { return name }
}

module.exports.resolveWoodFlexibleName = resolveWoodFlexibleName

function buildSpeciesCandidates(mcData, tokensMaybe) {
  const set = new Set()
  if (tokensMaybe && tokensMaybe.forEach) tokensMaybe.forEach(t => set.add(t))
  try {
    const names = Object.keys(mcData?.itemsByName || {})
    for (const n of names) {
      const idx = n.lastIndexOf('_')
      if (idx <= 0) continue
      const prefix = n.slice(0, idx)
      const base = n.slice(idx + 1)
      // Only include likely wood bases
      if (base === 'log' || base === 'planks' || base === 'stairs' || base === 'slab' || base === 'door' || base === 'fence' || base === 'fence_gate' || base === 'trapdoor' || base === 'sign' || base === 'pressure_plate' || base === 'button') {
        set.add(prefix)
      }
    }
  } catch (_) {}
  return Array.from(set)
}

// Expose debug helper for tests
module.exports.__debugSpeciesCandidates = (mcData) => buildSpeciesCandidates(mcData, null)
module.exports.__debugPickNearest = (bot, mcData, base) => pickNearestSpeciesInWorld(bot, buildSpeciesCandidates(mcData, null), base, mcData, { radius: 48 })

// Snapshot-based resolution (fast, avoids bot.findBlocks). Pass in snapshot.blocks array.
function resolveWithSnapshotFlexibleName(mcData, name, snapshotBlocks, opts = {}) {
  try {
    if (!getGenericWoodEnabled()) return name
    if (!name || typeof name !== 'string') return name

    // Determine base from generic_* or species-specific name
    let base = null
    if (name.startsWith('generic_')) {
      base = name.slice('generic_'.length)
    } else {
      const idx = name.lastIndexOf('_')
      if (idx <= 0) return name
      base = name.slice(idx + 1)
    }

    const speciesTokens = buildSpeciesCandidates(mcData, getWoodSpeciesTokens())
    if (!speciesTokens || speciesTokens.length === 0) return name

    // Inventory preference is not available here; use nearest by snapshot
    const center = opts.center || null
    function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx*dx + dy*dy + dz*dz }
    let best = null
    let bestD2 = Infinity
    const blocks = Array.isArray(snapshotBlocks) ? snapshotBlocks : []
    for (const s of speciesTokens) {
      const logName = `${s}_log`
      for (const b of blocks) {
        if (!b || !b.name) continue
        if (b.name === logName || b.name === `${s}_${base}`) {
          const d2 = center && b ? dist2(center, b) : 0
          if (d2 < bestD2) { bestD2 = d2; best = s }
        }
      }
    }
    if (best) return `${best}_${base}`

    // Planner context species fallback
    const ctx = getCurrentSpeciesContext()
    if (ctx) return `${ctx}_${base}`

    if (mcData.itemsByName[`oak_${base}`]) return `oak_${base}`
    return name
  } catch (_) { return name }
}

module.exports.resolveWithSnapshotFlexibleName = resolveWithSnapshotFlexibleName


