import { loadEnv } from '../utils/loadEnv';
loadEnv();

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as crypto from 'crypto';
import { LogMonitor } from './collector_runner/log_monitor';
import { BotStatus, RunSummary, computeExitCode, computeOverallResult, writeSummary } from './collector_runner/summary';
import { createRunDir } from '../utils/runDir';
import logger from '../utils/logger';
import { resolveBotSpecs, BotSpec, RunnerArgs } from './agent_bot/runner/roster';

interface RunnerCliConfig {
  rosterArgs: RunnerArgs;
  host: string;
  port: number;
  timeoutMs: number;
  staggerMs: number;
  targetsArg?: string;
  persist: boolean;
}

const DEFAULTS = {
  host: 'localhost',
  port: 25565,
  timeoutMs: 600000,
  staggerMs: 2000
};

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function splitList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

function parseRunnerCli(argv: string[] = process.argv.slice(2)): RunnerCliConfig {
  const rosterPath = getArgValue(argv, '--roster');
  const providers = splitList(getArgValue(argv, '--providers'));
  const models = splitList(getArgValue(argv, '--models'));
  const baseUrls = splitList(getArgValue(argv, '--base-urls'));
  const provider = getArgValue(argv, '--provider');
  const model = getArgValue(argv, '--model');
  const baseUrl = getArgValue(argv, '--base-url');
  const numBotsRaw = getArgValue(argv, '--num-bots');
  const numBots = numBotsRaw !== undefined ? Number(numBotsRaw) : undefined;

  const host = getArgValue(argv, '--host') ?? DEFAULTS.host;
  const port = Number(getArgValue(argv, '--port')) || DEFAULTS.port;
  const timeoutMs = Number(getArgValue(argv, '--timeout')) || DEFAULTS.timeoutMs;
  const staggerMs = Number(getArgValue(argv, '--stagger-ms') ?? DEFAULTS.staggerMs);

  const targetsArg = getArgValue(argv, '--targets');
  const persist = argv.includes('--persist');

  return {
    rosterArgs: {
      rosterPath,
      providers,
      models,
      baseUrls,
      provider,
      model,
      baseUrl,
      numBots
    },
    host,
    port,
    timeoutMs,
    staggerMs,
    targetsArg,
    persist
  };
}

function formatTargets(targets: BotSpec['targets']): string | undefined {
  if (!targets || targets.length === 0) return undefined;
  return targets.map(t => `${t.item} ${t.count}`).join(', ');
}

function providerTag(provider: string): string {
  return provider === 'openai-compat' ? 'local' : provider;
}

async function run(): Promise<void> {
  let cli: RunnerCliConfig;
  let specs: BotSpec[];
  try {
    cli = parseRunnerCli();
    specs = resolveBotSpecs(cli.rosterArgs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
  } catch (err: any) {
    logger.error('Failed to resolve runner config:', err.message);
    process.exit(4);
  }

  const startTime = new Date();
  // When launched under the dev harness, land artifacts in the dev rundir
  // alongside chat_in / chat_out so `make dev-logs BOT=...` finds them.
  const runDir = process.env.PATHCRAFTER_DEV_RUN_DIR ?? createRunDir();
  const runId = path.basename(runDir);

  logger.info(`Agent bot runner started — runId=${runId}, bots=${specs.length}, timeout=${cli.timeoutMs}ms`);
  logger.info(`Run directory: ${runDir}`);
  if (cli.targetsArg) {
    logger.info(`Default targets (broadcast): ${cli.targetsArg}`);
  }

  const scriptPath = path.resolve(__dirname, './agent_bot.js');

  const processes: ChildProcess[] = [];
  const monitors: LogMonitor[] = [];
  let finished = false;

  function finish(): void {
    if (finished) return;
    finished = true;

    for (const m of monitors) {
      m.stop();
    }

    for (const proc of processes) {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    }

    const endTime = new Date();
    const botStatuses: BotStatus[] = monitors.map(m => m.getStatus());
    const exitCode = computeExitCode(botStatuses);

    const summary: RunSummary = {
      runId,
      runDir,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - startTime.getTime(),
      bots: botStatuses,
      overallResult: computeOverallResult(exitCode),
      exitCode
    };

    writeSummary(runDir, summary);
    logger.info(`Agent bot runner complete — result=${summary.overallResult}, exitCode=${exitCode}`);
    logger.info(`Summary written to ${path.join(runDir, 'summary.json')}`);

    process.exit(exitCode);
  }

  const timeoutHandle = setTimeout(() => {
    logger.warn(`Agent bot runner timeout after ${cli.timeoutMs}ms`);
    for (const m of monitors) {
      m.markTimeout();
    }
    finish();
  }, cli.timeoutMs);

  let exited = 0;

  for (let i = 0; i < specs.length; i++) {
    if (i > 0 && cli.staggerMs > 0) {
      logger.info(`Waiting ${cli.staggerMs}ms before spawning bot ${i + 1}...`);
      await new Promise(resolve => setTimeout(resolve, cli.staggerMs));
    }

    const spec = specs[i];
    const suffix = crypto.randomBytes(2).toString('hex');
    const botName = spec.name ?? `${providerTag(spec.provider)}_${suffix}`;

    logger.info(`Spawning bot ${i + 1}/${specs.length}: ${botName} (${spec.provider}/${spec.model})`);

    const args: string[] = [
      scriptPath,
      cli.host,
      String(cli.port),
      botName,
      '--provider', spec.provider,
      '--model', spec.model
    ];

    if (spec.baseUrl) {
      args.push('--base-url', spec.baseUrl);
    }

    const targetsForBot = formatTargets(spec.targets) ?? cli.targetsArg;
    if (targetsForBot) {
      args.push('--targets', targetsForBot);
    }

    const proc = spawn('node', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        PATHCRAFTER_RUN_DIR: runDir,
        PATHCRAFTER_BOT_NAME: botName
      }
    });

    if (proc.stderr) {
      let lineBuf = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        lineBuf += chunk.toString();
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) logger.warn(`[${botName} stderr] ${line}`);
        }
      });
      proc.stderr.on('end', () => {
        if (lineBuf.trim()) logger.warn(`[${botName} stderr] ${lineBuf}`);
      });
    }

    processes.push(proc);

    const logPath = path.join(runDir, `${botName}.log`);
    const monitor = new LogMonitor(logPath, botName);
    monitors.push(monitor);
    monitor.start();

    monitor.onEvent((event) => {
      if (event.type === 'all_complete') {
        logger.info(`Bot ${botName} completed all targets`);
        // In persist mode (dev harness), don't tear down on target completion —
        // the bot stays up to accept more chat-initiated goals.
        if (!cli.persist) checkAllComplete();
      }
    });

    proc.on('error', (err) => {
      logger.error(`Bot ${botName} process error: ${err.message}`);
      monitor.markFailed();
    });

    proc.on('exit', (code) => {
      exited++;
      if (code !== 0) {
        logger.warn(`Bot ${botName} exited with code ${code}`);
        monitor.markFailed();
      }
      if (exited >= specs.length) {
        clearTimeout(timeoutHandle);
        setTimeout(() => finish(), 500);
      }
    });
  }

  function checkAllComplete(): void {
    const allDone = monitors.every(m => {
      const s = m.getStatus();
      return s.state === 'complete' || s.state === 'failed';
    });
    if (allDone) {
      clearTimeout(timeoutHandle);
      setTimeout(() => finish(), 500);
    }
  }

  process.on('SIGINT', () => {
    logger.info('Agent bot runner received SIGINT');
    for (const m of monitors) {
      m.markFailed();
    }
    clearTimeout(timeoutHandle);
    finish();
  });

  process.on('SIGTERM', () => {
    logger.info('Agent bot runner received SIGTERM');
    for (const m of monitors) {
      m.markFailed();
    }
    clearTimeout(timeoutHandle);
    finish();
  });
}

run();
