import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export function generateRunId(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('-');
  const hex = crypto.randomBytes(3).toString('hex');
  return `${date}_${time}_${hex}`;
}

export function createRunDir(baseDir?: string): string {
  const runId = generateRunId();
  const base = baseDir || path.join(process.cwd(), 'artifacts');
  const runDir = path.join(base, runId);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

export function resolveRunDir(): string {
  const envDir = process.env.PATHCRAFTER_RUN_DIR;
  if (envDir) {
    fs.mkdirSync(envDir, { recursive: true });
    return envDir;
  }
  return createRunDir();
}
