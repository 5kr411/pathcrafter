import { execSync, execFileSync } from 'child_process';
import * as crypto from 'crypto';

const CONTAINER_NAME = 'pathcrafter-e2e';
const IMAGE = 'itzg/minecraft-server';
const HEALTH_POLL_INTERVAL_MS = 3000;
const HEALTH_TIMEOUT_MS = 120_000;

export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

export interface ServerOptions {
  port?: number;
  seed?: string;
  difficulty?: Difficulty;
}

export function startServer(options: ServerOptions = {}): void {
  const port = options.port ?? 25565;
  const seed = options.seed ?? crypto.randomBytes(4).toString('hex');
  const difficulty = options.difficulty ?? 'normal';

  // Pre-flight checks
  checkDockerAvailable();
  checkNoExistingContainer();
  checkPortFree(port);

  console.log(`Starting Minecraft server (seed=${seed}, port=${port})...`);

  const args = [
    'run', '-d',
    '--name', CONTAINER_NAME,
    '--tmpfs', '/data/world',
    '-e', 'EULA=TRUE',
    '-e', 'VERSION=1.21.11',
    '-e', 'ONLINE_MODE=false',
    '-e', `SEED=${seed}`,
    '-e', `DIFFICULTY=${difficulty}`,
    '-e', 'SPAWN_PROTECTION=0',
    '-e', 'MAX_PLAYERS=100',
    '-p', `${port}:25565`,
    IMAGE
  ];

  execFileSync('docker', args, { stdio: 'pipe' });
  console.log('Container started, waiting for server to be ready...');

  waitForHealthy();
  console.log('Server is ready.');
}

export function grantOp(username: string): void {
  execFileSync(
    'docker', ['exec', CONTAINER_NAME, 'rcon-cli', `op ${username}`],
    { stdio: 'pipe' }
  );
}

export function stopServer(): void {
  try {
    execFileSync('docker', ['stop', CONTAINER_NAME], { stdio: 'pipe' });
  } catch (_) {
    // Container may already be stopped
  }
  try {
    execFileSync('docker', ['rm', '-v', CONTAINER_NAME], { stdio: 'pipe' });
  } catch (_) {
    // Container may already be removed
  }
}

export function isServerRunning(): boolean {
  try {
    const result = execFileSync(
      'docker', ['inspect', '--format', '{{.State.Health.Status}}', CONTAINER_NAME],
      { stdio: 'pipe', encoding: 'utf-8' }
    );
    return result.trim() === 'healthy';
  } catch (_) {
    return false;
  }
}

export function getPlayerCount(): number {
  try {
    const result = execFileSync(
      'docker', ['exec', CONTAINER_NAME, 'rcon-cli', 'list'],
      { stdio: 'pipe', encoding: 'utf-8' }
    );
    // Response: "There are N of M players online: ..."
    const match = result.match(/There are (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch (_) {
    return 0;
  }
}

function checkDockerAvailable(): void {
  try {
    execSync('docker info', { stdio: 'pipe' });
  } catch (_) {
    throw new Error('Docker is not available. Is Docker running?');
  }
}

function checkNoExistingContainer(): void {
  try {
    const result = execFileSync(
      'docker', ['inspect', '--format', '{{.State.Status}}', CONTAINER_NAME],
      { stdio: 'pipe', encoding: 'utf-8' }
    );
    const status = result.trim();
    throw new Error(
      `Container "${CONTAINER_NAME}" already exists (status: ${status}). ` +
      `Run "docker rm -f ${CONTAINER_NAME}" to remove it.`
    );
  } catch (err: any) {
    // If docker inspect failed, container doesn't exist — that's what we want
    if (err.message?.includes('already exists')) throw err;
  }
}

function checkPortFree(port: number): void {
  try {
    execSync(`lsof -i :${port} -sTCP:LISTEN`, { stdio: 'pipe' });
    throw new Error(`Port ${port} is already in use.`);
  } catch (err: any) {
    // lsof exits non-zero when nothing is listening — that's what we want
    if (err.message?.includes('already in use')) throw err;
  }
}

function waitForHealthy(): void {
  const start = Date.now();
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    if (isServerRunning()) return;
    execSync(`sleep ${HEALTH_POLL_INTERVAL_MS / 1000}`, { stdio: 'pipe' });
  }
  throw new Error(`Server did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s`);
}
