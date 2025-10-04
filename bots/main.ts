import { Worker } from 'worker_threads';

import logger from '../utils/logger';

if (process.argv.length < 4 || process.argv.length > 6) {
  logger.info('Usage : node main.js <num> <host> <port> [<name>] [<password>]');
  process.exit(1);
}

const num = parseInt(process.argv[2]);
const host = process.argv[3];
const port = parseInt(process.argv[4]);
const usernameBase = process.argv[5] || 'bot_';
const password = process.argv[6];

let workers: Worker[] = [];

function createWorker(i: number): void {
  if (i > num) return;

  const workerData = {
    host: host,
    port: port,
    username: `${usernameBase}${i}`,
    password: password
  };

  const worker = new Worker('./worker.js', { workerData });
  workers.push(worker);

  worker.on('error', (err) => logger.error(`Worker error: ${err}`));
  worker.on('exit', (code) => {
    if (code !== 0) logger.error(`Worker stopped with exit code ${code}`);
  });

  worker.on('message', (message: any) => {
    // logger.info(`Message from worker ${i}:`, message);
    workers.forEach((w) => {
      if (w !== worker) {
        w.postMessage({ from: message.from, type: message.type, data: message.data });
      }
    });
  });

  setTimeout(() => createWorker(i + 1), 200);
}

createWorker(1);

