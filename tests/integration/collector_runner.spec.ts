import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { computeExitCode, computeOverallResult, writeSummary, RunSummary } from '../../bots/collector_runner/summary';
import { LogMonitor } from '../../bots/collector_runner/log_monitor';

// This is a unit-level integration test that verifies the agent runner components
// work together correctly. It does NOT require a live Minecraft server.
describe('Agent Runner Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runner-integ-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('LogMonitor tracks bot through full lifecycle and summary is written correctly', () => {
    const uniqueName = `testbot_${crypto.randomBytes(3).toString('hex')}`;
    const logPath = path.join(tmpDir, `${uniqueName}.log`);

    // Simulate a bot writing JSON log lines
    const lines = [
      { ts: new Date().toISOString(), level: 'MILESTONE', bot: uniqueName, source: 'test', msg: 'bot ready' },
      { ts: new Date().toISOString(), level: 'MILESTONE', bot: uniqueName, source: 'test', msg: 'starting target 1/2: oak_log x8' },
      { ts: new Date().toISOString(), level: 'INFO', bot: uniqueName, source: 'test', msg: 'planning...' },
      { ts: new Date().toISOString(), level: 'MILESTONE', bot: uniqueName, source: 'test', msg: 'target complete: oak_log x8' },
      { ts: new Date().toISOString(), level: 'MILESTONE', bot: uniqueName, source: 'test', msg: 'starting target 2/2: cobblestone x16' },
      { ts: new Date().toISOString(), level: 'MILESTONE', bot: uniqueName, source: 'test', msg: 'target complete: cobblestone x16' },
      { ts: new Date().toISOString(), level: 'MILESTONE', bot: uniqueName, source: 'test', msg: 'all targets complete' }
    ];

    fs.writeFileSync(logPath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    // Create monitor and process the file
    const monitor = new LogMonitor(logPath, uniqueName);
    monitor.start();
    monitor.stop();

    const status = monitor.getStatus();
    expect(status.botName).toBe(uniqueName);
    expect(status.state).toBe('complete');
    expect(status.targetsComplete).toEqual(['oak_log x8', 'cobblestone x16']);
    expect(status.targetsFailed).toHaveLength(0);
    expect(status.errors).toHaveLength(0);

    // Write summary
    const exitCode = computeExitCode([status]);
    expect(exitCode).toBe(0);

    const summary: RunSummary = {
      runId: 'test-run',
      runDir: tmpDir,
      startTime: lines[0].ts,
      endTime: lines[lines.length - 1].ts,
      durationMs: 1000,
      bots: [status],
      overallResult: computeOverallResult(exitCode),
      exitCode
    };

    writeSummary(tmpDir, summary);

    const summaryPath = path.join(tmpDir, 'summary.json');
    expect(fs.existsSync(summaryPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    expect(written.overallResult).toBe('success');
    expect(written.exitCode).toBe(0);
    expect(written.bots[0].state).toBe('complete');
    expect(written.bots[0].targetsComplete).toEqual(['oak_log x8', 'cobblestone x16']);
  });

  it('handles partial failure scenario', () => {
    const botName1 = `bot_ok_${crypto.randomBytes(3).toString('hex')}`;
    const botName2 = `bot_fail_${crypto.randomBytes(3).toString('hex')}`;

    // Bot 1: succeeds
    const log1Path = path.join(tmpDir, `${botName1}.log`);
    fs.writeFileSync(log1Path, [
      JSON.stringify({ ts: new Date().toISOString(), level: 'MILESTONE', msg: 'starting target 1/1: oak_log x8' }),
      JSON.stringify({ ts: new Date().toISOString(), level: 'MILESTONE', msg: 'target complete: oak_log x8' }),
      JSON.stringify({ ts: new Date().toISOString(), level: 'MILESTONE', msg: 'all targets complete' })
    ].join('\n') + '\n');

    // Bot 2: fails
    const log2Path = path.join(tmpDir, `${botName2}.log`);
    fs.writeFileSync(log2Path, [
      JSON.stringify({ ts: new Date().toISOString(), level: 'MILESTONE', msg: 'starting target 1/1: diamond x4' }),
      JSON.stringify({ ts: new Date().toISOString(), level: 'ERROR', msg: 'pathfinding failed' })
    ].join('\n') + '\n');

    const m1 = new LogMonitor(log1Path, botName1);
    const m2 = new LogMonitor(log2Path, botName2);
    m1.start(); m1.stop();
    m2.start(); m2.stop();
    m2.markFailed();

    const statuses = [m1.getStatus(), m2.getStatus()];
    const exitCode = computeExitCode(statuses);
    expect(exitCode).toBe(1); // partial success
    expect(computeOverallResult(exitCode)).toBe('partial');
  });
});
