import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseAgentConfig, AgentConfig } from './collector_runner/config_parser';
import { LogMonitor } from './collector_runner/log_monitor';
import { BotStatus, RunSummary, computeExitCode, computeOverallResult, writeSummary } from './collector_runner/summary';
import { createRunDir } from '../utils/runDir';
import logger from '../utils/logger';

async function run(): Promise<void> {
  let config: AgentConfig;
  try {
    config = parseAgentConfig();
  } catch (err: any) {
    logger.error('Failed to parse agent config:', err.message);
    process.exit(4);
  }

  const startTime = new Date();
  const runDir = createRunDir();
  const runId = path.basename(runDir);

  logger.info(`Agent runner started — runId=${runId}, bots=${config.numBots}, timeout=${config.timeoutMs}ms`);
  logger.info(`Run directory: ${runDir}`);
  logger.info(`Targets: ${config.targets.map(t => `${t.item} x${t.count}`).join(', ')}`);

  const targetsArg = config.targets.map(t => `${t.item} ${t.count}`).join(', ');
  const scriptPath = path.resolve(__dirname, './collect_paths.js');

  const processes: ChildProcess[] = [];
  const monitors: LogMonitor[] = [];
  let finished = false;

  function finish(): void {
    if (finished) return;
    finished = true;

    // Stop all monitors
    for (const m of monitors) {
      m.stop();
    }

    // Kill remaining processes
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
    logger.info(`Agent runner complete — result=${summary.overallResult}, exitCode=${exitCode}`);
    logger.info(`Summary written to ${path.join(runDir, 'summary.json')}`);

    process.exit(exitCode);
  }

  // Overall timeout
  const timeoutHandle = setTimeout(() => {
    logger.warn(`Agent runner timeout after ${config.timeoutMs}ms`);
    for (const m of monitors) {
      m.markTimeout();
    }
    finish();
  }, config.timeoutMs);

  let exited = 0;

  for (let i = 0; i < config.numBots; i++) {
    if (i > 0 && config.staggerMs > 0) {
      logger.info(`Waiting ${config.staggerMs}ms before spawning bot ${i + 1}...`);
      await new Promise(resolve => setTimeout(resolve, config.staggerMs));
    }

    const suffix = crypto.randomBytes(2).toString('hex');
    const botName = config.numBots === 1
      ? `${config.usernameBase}_${suffix}`
      : `${config.usernameBase}_${i}_${suffix}`;

    logger.info(`Spawning bot ${i + 1}/${config.numBots}: ${botName}`);

    const args = [scriptPath, config.host, String(config.port), botName, '--targets', targetsArg];

    const proc = spawn('node', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        PATHCRAFTER_RUN_DIR: runDir,
        PATHCRAFTER_BOT_NAME: botName
      }
    });

    // Capture stderr for error reporting
    let stderrBuf = '';
    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });
    }

    processes.push(proc);

    const logPath = path.join(runDir, `${botName}.log`);
    const monitor = new LogMonitor(logPath, botName);
    monitors.push(monitor);
    monitor.start();

    // Track bot completion
    monitor.onEvent((event) => {
      if (event.type === 'all_complete') {
        logger.info(`Bot ${botName} completed all targets`);
        checkAllComplete();
      }
    });

    proc.on('error', (err) => {
      logger.error(`Bot ${botName} process error: ${err.message}`);
      monitor.markFailed();
    });

    proc.on('exit', (code) => {
      exited++;
      if (code !== 0) {
        if (stderrBuf.trim()) {
          logger.error(`Bot ${botName} stderr: ${stderrBuf.trim().slice(0, 500)}`);
        }
        logger.warn(`Bot ${botName} exited with code ${code}`);
        monitor.markFailed();
      }
      // If all processes have exited, finish
      if (exited >= config.numBots) {
        clearTimeout(timeoutHandle);
        // Give monitors a moment to read final log lines
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
      // Give a moment for final log writes
      setTimeout(() => finish(), 500);
    }
  }

  process.on('SIGINT', () => {
    logger.info('Agent runner received SIGINT');
    for (const m of monitors) {
      m.markFailed();
    }
    clearTimeout(timeoutHandle);
    finish();
  });

  process.on('SIGTERM', () => {
    logger.info('Agent runner received SIGTERM');
    for (const m of monitors) {
      m.markFailed();
    }
    clearTimeout(timeoutHandle);
    finish();
  });
}

run();
