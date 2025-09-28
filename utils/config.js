let genericWoodEnabled = true;

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

module.exports = {
    setGenericWoodEnabled,
    getGenericWoodEnabled
};


