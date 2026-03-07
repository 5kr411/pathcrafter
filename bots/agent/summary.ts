import * as fs from 'fs';
import * as path from 'path';

export interface BotStatus {
  botName: string;
  state: 'starting' | 'running' | 'complete' | 'failed' | 'timeout';
  targetsComplete: string[];
  targetsFailed: string[];
  errors: string[];
  lastActivityTs: number;
}

export interface RunSummary {
  runId: string;
  runDir: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  bots: BotStatus[];
  overallResult: 'success' | 'partial' | 'failure' | 'timeout';
  exitCode: number;
}

export function computeExitCode(bots: BotStatus[]): number {
  if (bots.length === 0) return 4;

  const hasTimeout = bots.some(b => b.state === 'timeout');
  if (hasTimeout) return 3;

  const allComplete = bots.every(b => b.state === 'complete');
  if (allComplete) return 0;

  const someComplete = bots.some(b => b.state === 'complete');
  if (someComplete) return 1;

  return 2;
}

export function computeOverallResult(exitCode: number): RunSummary['overallResult'] {
  switch (exitCode) {
    case 0: return 'success';
    case 1: return 'partial';
    case 3: return 'timeout';
    default: return 'failure';
  }
}

export function writeSummary(runDir: string, summary: RunSummary): void {
  const summaryPath = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
}
