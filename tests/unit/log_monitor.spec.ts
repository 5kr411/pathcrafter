import { LogMonitor, LogEvent } from '../../bots/collector_runner/log_monitor';

describe('LogMonitor', () => {
  function createMonitor(): LogMonitor {
    return new LogMonitor('/tmp/nonexistent.log', 'testbot');
  }

  describe('processLine', () => {
    it('detects "starting target" and sets state to running', () => {
      const monitor = createMonitor();
      monitor.processLine(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'MILESTONE',
        msg: 'starting target 1/3: oak_log x16'
      }));
      expect(monitor.getStatus().state).toBe('running');
    });

    it('detects "target complete:" and adds to targetsComplete', () => {
      const monitor = createMonitor();
      monitor.processLine(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'MILESTONE',
        msg: 'target complete: oak_log x16'
      }));
      expect(monitor.getStatus().targetsComplete).toEqual(['oak_log x16']);
    });

    it('detects "target N failed" and adds to targetsFailed', () => {
      const monitor = createMonitor();
      monitor.processLine(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'MILESTONE',
        msg: 'target 1 failed after 5 attempts, moving to next target'
      }));
      expect(monitor.getStatus().targetsFailed).toHaveLength(1);
    });

    it('detects "all targets complete" and sets state to complete', () => {
      const monitor = createMonitor();
      monitor.processLine(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'MILESTONE',
        msg: 'all targets complete'
      }));
      expect(monitor.getStatus().state).toBe('complete');
    });

    it('detects ERROR level and adds to errors', () => {
      const monitor = createMonitor();
      monitor.processLine(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'ERROR',
        msg: 'something broke'
      }));
      expect(monitor.getStatus().errors).toEqual(['something broke']);
    });

    it('emits events for state changes', () => {
      const monitor = createMonitor();
      const events: LogEvent[] = [];
      monitor.onEvent(e => events.push(e));

      monitor.processLine(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'MILESTONE',
        msg: 'starting target 1/1: diamond x4'
      }));
      monitor.processLine(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'MILESTONE',
        msg: 'target complete: diamond x4'
      }));
      monitor.processLine(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'MILESTONE',
        msg: 'all targets complete'
      }));

      expect(events.map(e => e.type)).toEqual(['starting', 'target_complete', 'all_complete']);
    });

    it('ignores invalid JSON lines', () => {
      const monitor = createMonitor();
      monitor.processLine('not json');
      expect(monitor.getStatus().state).toBe('starting');
    });

    it('updates lastActivityTs on each line', () => {
      const monitor = createMonitor();
      const ts = '2026-01-15T12:00:00.000Z';
      monitor.processLine(JSON.stringify({ ts, level: 'INFO', msg: 'hello' }));
      expect(monitor.getStatus().lastActivityTs).toBe(new Date(ts).getTime());
    });
  });

  describe('markTimeout / markFailed', () => {
    it('markTimeout sets state to timeout', () => {
      const monitor = createMonitor();
      monitor.markTimeout();
      expect(monitor.getStatus().state).toBe('timeout');
    });

    it('markFailed sets state to failed when not complete', () => {
      const monitor = createMonitor();
      monitor.markFailed();
      expect(monitor.getStatus().state).toBe('failed');
    });

    it('markFailed does not override complete', () => {
      const monitor = createMonitor();
      monitor.processLine(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'MILESTONE',
        msg: 'all targets complete'
      }));
      monitor.markFailed();
      expect(monitor.getStatus().state).toBe('complete');
    });
  });
});
