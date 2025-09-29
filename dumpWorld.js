const mineflayer = require('mineflayer');
const { captureRawWorldSnapshot, saveSnapshotToFile } = require('./utils/worldSnapshot');

const host = process.argv[2] || 'localhost';
const port = parseInt(process.argv[3] || '25565', 10);
const username = process.argv[4] || 'bot_dump';
const password = process.argv[5] || undefined;
const chunkRadius = Number.isFinite(parseInt(process.argv[6], 10)) ? parseInt(process.argv[6], 10) : 3;

const bot = mineflayer.createBot({ host, port, username, password });

function safeExit(code) {
    try { bot.quit(); } catch (_) {}
    process.exit(code);
}

bot.once('spawn', () => {
    setTimeout(() => {
        try {
            const { getDefaultSnapshotChunkRadius } = require('./utils/config');
            const raw = captureRawWorldSnapshot(bot, { chunkRadius: Number.isFinite(chunkRadius) ? chunkRadius : getDefaultSnapshotChunkRadius(), includeAir: false });
            const dim = (bot.game && bot.game.dimension) ? String(bot.game.dimension).replace(/[^a-z0-9_\-]/gi, '_') : 'overworld';
            const outPath = `./world_snapshots/raw_${dim}_${Date.now()}.json`;
            saveSnapshotToFile(raw, outPath);
            console.log(`Saved world snapshot to ${outPath}`);
            safeExit(0);
        } catch (err) {
            console.error('Error capturing snapshot:', err && err.stack ? err.stack : err);
            safeExit(2);
        }
    }, 4000);
});

bot.on('kicked', (reason) => {
    console.error('Kicked:', reason);
    safeExit(3);
});

bot.on('end', () => {
    safeExit(0);
});

bot.on('error', (err) => {
    console.error('Bot error:', err && err.stack ? err.stack : err);
});


