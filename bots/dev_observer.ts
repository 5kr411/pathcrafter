// bots/dev_observer.ts
//
// Creative-mode observer bot for the dev harness. Reads commands from
// `${PATHCRAFTER_DEV_RUN_DIR}/chat_in` and appends all in-game chat and
// system messages to `${PATHCRAFTER_DEV_RUN_DIR}/chat_out`.
const mineflayer = require('mineflayer');
import * as fs from 'fs';
import * as path from 'path';
import { pollChatIn } from './dev_observer/poll';

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
  bot.chat('/gamemode spectator');
  setTimeout(() => bot.chat('/tp @s ~ ~100 ~'), 500);
  setupPolling();
});

function appendOut(line: string): void {
  fs.appendFileSync(chatOut, line + '\n');
}

bot.on('chat', (username: string, message: string) => {
  appendOut(`${new Date().toISOString()} <${username}> ${message}`);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party untyped
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
      const r = pollChatIn(chatIn, lastSize, (line) => bot.chat(line));
      lastSize = r.lastSize;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      appendOut(`${new Date().toISOString()} [err] poll: ${err.message}`);
    }
  }, 500);
}

process.on('SIGINT', () => bot.quit());
process.on('SIGTERM', () => bot.quit());
