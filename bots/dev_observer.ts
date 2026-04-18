// bots/dev_observer.ts
//
// Creative-mode observer bot for the dev harness. Reads commands from
// `${PATHCRAFTER_DEV_RUN_DIR}/chat_in` and appends all in-game chat and
// system messages to `${PATHCRAFTER_DEV_RUN_DIR}/chat_out`.
const mineflayer = require('mineflayer');
import * as fs from 'fs';
import * as path from 'path';

const host = process.argv[2] ?? 'localhost';
const port = parseInt(process.argv[3] ?? '25565', 10);
const rundir = process.env.PATHCRAFTER_DEV_RUN_DIR;
if (!rundir) {
  console.error('PATHCRAFTER_DEV_RUN_DIR env required');
  process.exit(4);
}

const chatIn = path.join(rundir, 'chat_in');
const chatOut = path.join(rundir, 'chat_out');
fs.writeFileSync(chatIn, '', { flag: 'a' });
fs.writeFileSync(chatOut, '', { flag: 'a' });

const bot = mineflayer.createBot({ host, port, username: 'dev_observer' });

bot.once('spawn', () => {
  bot.chat('/gamemode creative');
  setTimeout(() => bot.chat('/tp @s ~ ~100 ~'), 500);
  setupPolling();
});

function appendOut(line: string): void {
  fs.appendFileSync(chatOut, line + '\n');
}

bot.on('chat', (username: string, message: string) => {
  appendOut(`${new Date().toISOString()} <${username}> ${message}`);
});

bot.on('message', (json: any) => {
  const raw = json.toString?.() || JSON.stringify(json);
  // Only log system/death messages here (chat already logged above)
  if (!/^<[^>]+>/.test(raw)) appendOut(`${new Date().toISOString()} [sys] ${raw}`);
});

function setupPolling(): void {
  let lastSize = 0;
  try {
    lastSize = fs.statSync(chatIn).size;
  } catch (_) {}
  setInterval(() => {
    try {
      const stat = fs.statSync(chatIn);
      if (stat.size <= lastSize) return;
      const fd = fs.openSync(chatIn, 'r');
      const buf = Buffer.alloc(stat.size - lastSize);
      fs.readSync(fd, buf, 0, buf.length, lastSize);
      fs.closeSync(fd);
      lastSize = stat.size;
      for (const line of buf.toString('utf8').split('\n')) {
        const t = line.trim();
        if (t) bot.chat(t);
      }
    } catch (err: any) {
      appendOut(`${new Date().toISOString()} [err] poll: ${err.message}`);
    }
  }, 500);
}

process.on('SIGINT', () => bot.quit());
process.on('SIGTERM', () => bot.quit());
