import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { startServer, Difficulty } from './server';
import { setupSpawn } from './setup_spawn';
import { teardown } from './teardown';

interface DevConfig {
  roster: string;
  host: string;
  port: number;
  biome?: string;
  difficulty: Difficulty;
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parseArgs(): DevConfig {
  const args = process.argv.slice(2);

  const roster = getArg(args, '--roster');
  if (!roster) {
    console.error('--roster required');
    process.exit(4);
  }

  return {
    roster,
    host: getArg(args, '--host') ?? 'localhost',
    port: Number(getArg(args, '--port')) || 25565,
    biome: getArg(args, '--biome'),
    difficulty: (getArg(args, '--difficulty') as Difficulty) ?? 'peaceful'
  };
}

function makeRunDir(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(process.cwd(), 'artifacts', `dev-${ts}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function spawnDevObserver(host: string, port: number, runDir: string): ChildProcess {
  const scriptPath = path.resolve(__dirname, '../bots/dev_observer.js');
  const proc = spawn('node', [scriptPath, host, String(port)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PATHCRAFTER_DEV_RUN_DIR: runDir
    }
  });
  return proc;
}

function spawnAgentRunner(config: DevConfig, runDir: string): ChildProcess {
  const scriptPath = path.resolve(__dirname, '../bots/agent_bot_runner.js');
  const args = [
    scriptPath,
    '--roster', config.roster,
    '--host', config.host,
    '--port', String(config.port),
    // Dev harness is long-running; the runner's 10-minute default would
    // SIGTERM bots mid-goal. Use a 30-day effective-infinity instead.
    '--timeout', String(30 * 24 * 60 * 60 * 1000)
  ];
  const proc = spawn('node', args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      PATHCRAFTER_DEV_RUN_DIR: runDir
    }
  });
  return proc;
}

async function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
  if (proc.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const onDone = () => {
      if (done) return;
      done = true;
      resolve();
    };
    proc.once('exit', onDone);
    setTimeout(onDone, timeoutMs);
  });
}

async function main(): Promise<void> {
  const config = parseArgs();
  const runDir = makeRunDir();

  // Step 1: start Docker MC server
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

  // Step 2: spawn setup
  try {
    await setupSpawn({
      host: config.host,
      port: config.port,
      biome: config.biome
    });
  } catch (err: any) {
    console.error('Spawn setup failed:', err.message);
    teardown();
    process.exit(6);
  }

  // Step 3: spawn dev_observer
  const observer = spawnDevObserver(config.host, config.port, runDir);
  observer.on('exit', (code) => {
    console.error(`[dev] dev_observer exited with code ${code}; harness stays up`);
  });
  observer.on('error', (err) => {
    console.error(`[dev] dev_observer spawn error: ${err.message}`);
  });

  // Give the observer a moment to connect before the agent swarm starts
  // so we don't miss its early spawn chatter.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Step 4: spawn agent roster
  const runner = spawnAgentRunner(config, runDir);
  runner.on('exit', (code) => {
    console.error(`[dev] agent_bot_runner exited with code ${code}; harness stays up`);
  });
  runner.on('error', (err) => {
    console.error(`[dev] agent_bot_runner spawn error: ${err.message}`);
  });

  // Step 5: print startup banner
  console.log('');
  console.log('dev harness up');
  console.log(`  rundir:    ${runDir}`);
  console.log(`  chat_in:   ${path.join(runDir, 'chat_in')}   (append one line per message to send)`);
  console.log(`  chat_out:  ${path.join(runDir, 'chat_out')}  (tail for chat events)`);
  console.log(`  agent logs: ${runDir}/<botname>.log`);
  console.log("use 'make dev-down' or ^C to shut down");
  console.log('');

  // Step 6: stay alive until signal
  let shuttingDown = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[dev] received ${sig}, shutting down...`);

    for (const proc of [runner, observer]) {
      if (proc.exitCode === null && !proc.killed) {
        try {
          proc.kill('SIGTERM');
        } catch (_) {}
      }
    }

    await waitForExit(runner, 10_000);
    await waitForExit(observer, 5_000);

    try {
      teardown();
    } catch (err: any) {
      console.error('[dev] teardown error:', err.message);
    }

    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

main();
