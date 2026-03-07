import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BotStatus, RunSummary, computeExitCode, computeOverallResult, writeSummary } from '../../bots/agent/summary';

function makeBot(overrides: Partial<BotStatus> = {}): BotStatus {
  return {
    botName: 'bot1',
    state: 'complete',
    targetsComplete: [],
    targetsFailed: [],
    errors: [],
    lastActivityTs: Date.now(),
    ...overrides
  };
}

describe('computeExitCode', () => {
  it('returns 0 when all bots are complete', () => {
    expect(computeExitCode([makeBot(), makeBot()])).toBe(0);
  });

  it('returns 1 when some bots complete and some fail', () => {
    expect(computeExitCode([
      makeBot({ state: 'complete' }),
      makeBot({ state: 'failed' })
    ])).toBe(1);
  });

  it('returns 2 when no bots complete', () => {
    expect(computeExitCode([
      makeBot({ state: 'failed' }),
      makeBot({ state: 'failed' })
    ])).toBe(2);
  });

  it('returns 3 when any bot has timeout', () => {
    expect(computeExitCode([
      makeBot({ state: 'complete' }),
      makeBot({ state: 'timeout' })
    ])).toBe(3);
  });

  it('returns 4 when no bots', () => {
    expect(computeExitCode([])).toBe(4);
  });
});

describe('computeOverallResult', () => {
  it('maps exit codes to result strings', () => {
    expect(computeOverallResult(0)).toBe('success');
    expect(computeOverallResult(1)).toBe('partial');
    expect(computeOverallResult(2)).toBe('failure');
    expect(computeOverallResult(3)).toBe('timeout');
    expect(computeOverallResult(4)).toBe('failure');
  });
});

describe('writeSummary', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes summary.json to run directory', () => {
    const summary: RunSummary = {
      runId: 'test-run',
      runDir: tmpDir,
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:01:00.000Z',
      durationMs: 60000,
      bots: [makeBot()],
      overallResult: 'success',
      exitCode: 0
    };

    writeSummary(tmpDir, summary);

    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, 'summary.json'), 'utf-8'));
    expect(written.runId).toBe('test-run');
    expect(written.overallResult).toBe('success');
    expect(written.bots).toHaveLength(1);
  });
});
