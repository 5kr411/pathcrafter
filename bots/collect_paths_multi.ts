import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import logger from '../utils/logger';

if (process.argv.length < 3) {
  logger.info('Usage: node collect_paths_multi.js <num> [<host>] [<port>] [<name_base>] [<password>]');
  logger.info('Example: node collect_paths_multi.js 10 localhost 25565 collector');
  process.exit(1);
}

const num = parseInt(process.argv[2]);
const host = process.argv[3] || 'localhost';
const port = process.argv[4] || '25565';
const usernameBase = process.argv[5] || 'collector';
const password = process.argv[6];

if (isNaN(num) || num < 1) {
  logger.error('Number of instances must be a positive integer');
  process.exit(1);
}

const processes: ChildProcess[] = [];

const scriptPath = path.resolve(__dirname, './collect_paths.js');

function spawnCollector(index: number): void {
  if (index > num) {
    logger.info(`All ${num} collector instances spawned`);
    return;
  }

  const username = num === 1 ? usernameBase : `${usernameBase}${index}`;
  const args = [scriptPath, host, port, username];
  if (password) {
    args.push(password);
  }

  logger.info(`Spawning collector ${index}/${num}: ${username}`);
  
  const proc = spawn('node', args, {
    stdio: ['inherit', 'inherit', 'inherit']
  });

  processes.push(proc);

  proc.on('error', (err) => {
    logger.error(`Collector ${username} error: ${err.message}`);
  });

  proc.on('exit', (code, signal) => {
    if (code !== 0) {
      logger.warn(`Collector ${username} exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
    } else {
      logger.info(`Collector ${username} exited gracefully`);
    }
  });

  setTimeout(() => spawnCollector(index + 1), 500);
}

process.on('SIGINT', () => {
  logger.info('Received SIGINT, terminating all collectors');
  processes.forEach(proc => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  });
  setTimeout(() => {
    processes.forEach(proc => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    });
    process.exit(0);
  }, 5000);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, terminating all collectors');
  processes.forEach(proc => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  });
  setTimeout(() => process.exit(0), 5000);
});

logger.info(`Starting ${num} collector instances`);
logger.info(`Server: ${host}:${port}`);
logger.info(`Username base: ${usernameBase}`);

spawnCollector(1);

