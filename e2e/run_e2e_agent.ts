import { loadEnv } from '../utils/loadEnv';
loadEnv();

import { spawn } from 'child_process';
import * as path from 'path';
import { startServer, stopServer, Difficulty } from './server';
import { setupSpawn } from './setup_spawn';
import { teardown } from './teardown';

interface E2eAgentConfig {
  roster?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  providers?: string;
  models?: string;
  baseUrls?: string;
  numBots?: number;
  targets?: string;
  timeout: number;
  host: string;
  port: number;
  biome?: string;
  difficulty: Difficulty;
  staggerMs?: number;
}

function parseArgs(): E2eAgentConfig {
  const args = process.argv.slice(2);

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  }

  const roster = getArg('--roster');
  const provider = getArg('--provider');
  const model = getArg('--model');
  const providers = getArg('--providers');
  const models = getArg('--models');

  const hasRoster = Boolean(roster);
  const hasHomogeneous = Boolean(provider && model);
  const hasCommaList = Boolean(providers && models);

  if (!hasRoster && !hasHomogeneous && !hasCommaList) {
    console.error('One of --roster, (--provider + --model), or (--providers + --models) is required');
    process.exit(4);
  }

  return {
    roster,
    provider,
    model,
    baseUrl: getArg('--base-url'),
    providers,
    models,
    baseUrls: getArg('--base-urls'),
    numBots: Number(getArg('--num-bots')) || undefined,
    targets: getArg('--targets'),
    timeout: Number(getArg('--timeout')) || 600_000,
    host: getArg('--host') ?? 'localhost',
    port: Number(getArg('--port')) || 25565,
    biome: getArg('--biome'),
    difficulty: (getArg('--difficulty') as Difficulty) ?? 'peaceful',
    staggerMs: Number(getArg('--stagger-ms')) || undefined
  };
}

async function runAgentBotRunner(config: E2eAgentConfig): Promise<number> {
  const scriptPath = path.resolve(__dirname, '../bots/agent_bot_runner.js');

  const args: string[] = [
    scriptPath,
    '--host', config.host,
    '--port', String(config.port),
    '--timeout', String(config.timeout)
  ];

  if (config.roster) args.push('--roster', config.roster);
  if (config.provider) args.push('--provider', config.provider);
  if (config.model) args.push('--model', config.model);
  if (config.baseUrl) args.push('--base-url', config.baseUrl);
  if (config.providers) args.push('--providers', config.providers);
  if (config.models) args.push('--models', config.models);
  if (config.baseUrls) args.push('--base-urls', config.baseUrls);
  if (config.numBots !== undefined) args.push('--num-bots', String(config.numBots));
  if (config.targets) args.push('--targets', config.targets);
  if (config.staggerMs) args.push('--stagger-ms', String(config.staggerMs));

  return new Promise<number>((resolve) => {
    const proc = spawn('node', args, {
      stdio: 'inherit',
      env: process.env
    });

    proc.on('error', (err) => {
      console.error('Failed to spawn agent_bot_runner:', err.message);
      resolve(2);
    });

    proc.on('exit', (code) => {
      resolve(code ?? 2);
    });
  });
}

async function main(): Promise<void> {
  const config = parseArgs();

  try {
    startServer({
      port: config.port,
      seed: undefined,
      difficulty: config.difficulty
    });
  } catch (err: any) {
    console.error('Server start failed:', err.message);
    process.exit(5);
  }

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

  console.log('Starting LLM agent swarm...');
  const exitCode = await runAgentBotRunner(config);

  teardown();

  process.exit(exitCode);
}

main();
