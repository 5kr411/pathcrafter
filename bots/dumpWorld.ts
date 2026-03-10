import mineflayer from 'mineflayer';
import { beginSnapshotScan, stepSnapshotScan, snapshotFromState, saveSnapshotToFile } from '../utils/worldSnapshot';
import { getDefaultSnapshotChunkRadius } from '../utils/config';
import logger from '../utils/logger';

const host = process.argv[2] || 'localhost';
const port = parseInt(process.argv[3] || '25565', 10);
const username = process.argv[4] || 'bot_dump';
const password = process.argv[5] || undefined;
const chunkRadius = Number.isFinite(parseInt(process.argv[6], 10)) ? parseInt(process.argv[6], 10) : 3;

const bot = mineflayer.createBot({ host, port, username, password });

function safeExit(code: number): void {
    try { bot.quit(); } catch (_) {}
    process.exit(code);
}

bot.once('spawn', () => {
    setTimeout(async () => {
        try {
            const cr = Number.isFinite(chunkRadius) ? chunkRadius : getDefaultSnapshotChunkRadius();
            const scan = beginSnapshotScan(bot as any, {
                chunkRadius: cr,
                includeAir: false
            });
            await stepSnapshotScan(scan);
            const raw = snapshotFromState(scan);
            const dim = (bot.game && bot.game.dimension) ? String(bot.game.dimension).replace(/[^a-z0-9_\-]/gi, '_') : 'overworld';
            const outPath = `./world_snapshots/raw_${dim}_${Date.now()}.json`;
            saveSnapshotToFile(raw, outPath);
            logger.info(`Saved world snapshot to ${outPath}`);
            safeExit(0);
        } catch (err: any) {
            logger.error('Error capturing snapshot:', err && err.stack ? err.stack : err);
            safeExit(2);
        }
    }, 4000);
});

bot.on('kicked', (reason) => {
    logger.error('Kicked:', reason);
    safeExit(3);
});

bot.on('end', () => {
    safeExit(0);
});

bot.on('error', (err) => {
    logger.error('Bot error:', err && err.stack ? err.stack : err);
});
