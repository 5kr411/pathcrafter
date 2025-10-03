const { getSafeFindRepeatThreshold } = require('../utils/config')
const logger = require('../utils/logger')

function posKey(p) { return p ? `${p.x},${p.y},${p.z}` : 'nil' }

class BehaviorSafeFindBlock {
    constructor(bot, targets) {
        this.stateName = 'safeFindBlock'
        this.active = false
        this.bot = bot
        this.targets = targets

        this.blocks = []
        this.maxDistance = 32
        this.preventXRay = false

        this._excluded = new Set()
        this._returnCounts = new Map()
        this._countThreshold = Math.max(1, Number(getSafeFindRepeatThreshold && getSafeFindRepeatThreshold() || 3))
    }

    addExcludedPosition(pos) {
        try {
            if (!pos) return
            const key = posKey(pos)
            this._excluded.add(key)
        } catch (_) {}
    }

    isExcluded(pos) {
        try {
            const key = posKey(pos)
            if (this._excluded.has(key)) return true
            const cnt = this._returnCounts.get(key) || 0
            return cnt >= this._countThreshold
        } catch (_) { return false }
    }

    matchesBlock(block) {
        try {
            if (!this.blocks || this.blocks.length === 0) return false
            if (!this.blocks.includes(block.type)) return false
            if (this.preventXRay) {
                if (!this.bot.canSeeBlock(block)) return false
            }
            return true
        } catch (_) { return false }
    }

    _recordReturn(pos) {
        try {
            const key = posKey(pos)
            const next = (this._returnCounts.get(key) || 0) + 1
            this._returnCounts.set(key, next)
            if (next >= this._countThreshold && !this._excluded.has(key)) {
                this._excluded.add(key)
                try { logger.info('BehaviorSafeFindBlock: excluding position after repeats', pos) } catch (_) {}
            }
        } catch (_) {}
    }

    onStateEntered() {
        try {
            const candidates = this.bot.findBlocks({
                matching: (block) => this.matchesBlock(block),
                maxDistance: this.maxDistance,
                count: 64
            }) || []
            let chosen = undefined
            for (const p of candidates) {
                if (!this.isExcluded(p)) { chosen = p; break }
            }
            if (chosen) {
                this.targets.position = chosen
                this._recordReturn(chosen)
            } else {
                this.targets.position = undefined
            }
        } catch (err) {
            this.targets.position = undefined
        }
    }
}

module.exports = function createSafeFindBlock(bot, targets) {
    return new BehaviorSafeFindBlock(bot, targets)
}


