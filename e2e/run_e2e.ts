import { spawn } from 'child_process';
import * as path from 'path';
import { startServer, stopServer, Difficulty } from './server';
import { setupSpawn } from './setup_spawn';
import { teardown } from './teardown';

interface E2eConfig {
  targets: string;
  numBots: number;
  timeout: number;
  host: string;
  port: number;
  biome?: string;
  difficulty: Difficulty;
  staggerMs?: number;
}

function parseArgs(): E2eConfig {
  const args = process.argv.slice(2);

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  }

  const targets = getArg('--targets');
  if (!targets) {
    console.error('--targets is required');
    process.exit(4);
  }

  return {
    targets,
    numBots: Number(getArg('--num-bots')) || 1,
    timeout: Number(getArg('--timeout')) || 600_000,
    host: getArg('--host') ?? 'localhost',
    port: Number(getArg('--port')) || 25565,
    biome: getArg('--biome'),
    difficulty: (getArg('--difficulty') as Difficulty) ?? 'peaceful',
    staggerMs: Number(getArg('--stagger-ms')) || undefined
  };
}

async function runCollectorRunner(config: E2eConfig): Promise<number> {
  const scriptPath = path.resolve(__dirname, '../bots/collector_runner.js');

  const args = [
    scriptPath,
    '--targets', config.targets,
    '--num-bots', String(config.numBots),
    '--timeout', String(config.timeout),
    '--host', config.host,
    '--port', String(config.port)
  ];

  if (config.staggerMs) {
    args.push('--stagger-ms', String(config.staggerMs));
  }

  return new Promise<number>((resolve) => {
    const proc = spawn('node', args, {
      stdio: 'inherit',
      env: process.env
    });

    proc.on('error', (err) => {
      console.error('Failed to spawn collector_runner:', err.message);
      resolve(2);
    });

    proc.on('exit', (code) => {
      resolve(code ?? 2);
    });
  });
}

async function main(): Promise<void> {
  const config = parseArgs();

  // Step 1: Start server
  try {
    startServer({
      port: config.port,
      seed: undefined,  // random each run
      difficulty: config.difficulty
    });
  } catch (err: any) {
    console.error('Server start failed:', err.message);
    process.exit(5);
  }

  // Step 2: Setup spawn
  try {
    await setupSpawn({
      host: config.host,
      port: config.port,
      biome: config.biome
    });
  } catch (err: any) {
    console.error('Spawn setup failed:', err.message);
    stopServer();
    process.exit(6);
  }

  // Step 3: Run bots
  console.log('Starting collector swarm...');
  const exitCode = await runCollectorRunner(config);

  // Step 4: Teardown
  teardown();

  process.exit(exitCode);
}

main();
