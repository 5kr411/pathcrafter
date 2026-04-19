import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';

/**
 * Regression test: resolveCurrent must clear the inFlight Set, otherwise a
 * completed replacement leaves a stale "already in progress" guard that
 * rejects every subsequent request for the same tool.
 */
describe('ToolReplacementExecutor inFlight lifecycle', () => {
  function makeExecutor(toolsBeingReplaced: Set<string>): ToolReplacementExecutor {
    const bot = {} as any;
    const workerManager = {} as any;
    const safeChat = () => {};
    const config = {
      snapshotRadii: [32],
      snapshotYHalf: null,
      pruneWithWorld: false,
      combineSimilarNodes: false,
      perGenerator: 1,
      toolDurabilityThreshold: 0.1
    };
    return new ToolReplacementExecutor(bot, workerManager, safeChat, config, toolsBeingReplaced);
  }

  it('accepts a second executeReplacement for the same tool after the first resolves', async () => {
    const toolsBeingReplaced = new Set<string>();
    const executor = makeExecutor(toolsBeingReplaced);

    // First request: should queue and return a pending promise.
    const p1 = executor.executeReplacement('iron_pickaxe');
    expect(toolsBeingReplaced.has('iron_pickaxe')).toBe(true);

    // Simulate the lifecycle the tool layer drives: force-stop the executor,
    // which resolves the current request and performs full cleanup. This is
    // a conservative way to exercise resolveCurrent without standing up a
    // real ToolReplacementTask (which requires a worker + mcData).
    executor.stop();

    const firstResult = await p1;
    expect(firstResult).toBe(false);
    expect(toolsBeingReplaced.has('iron_pickaxe')).toBe(false);

    // Second request for the same tool must be accepted — inFlight must have
    // been cleared when the first resolved.
    const p2 = executor.executeReplacement('iron_pickaxe');
    expect(toolsBeingReplaced.has('iron_pickaxe')).toBe(true);

    // Clean up the second promise so jest doesn't warn.
    executor.stop();
    await p2;
  });

  it('continues to reject concurrent requests for the same tool while one is in flight', async () => {
    const toolsBeingReplaced = new Set<string>();
    const executor = makeExecutor(toolsBeingReplaced);

    const p1 = executor.executeReplacement('iron_pickaxe');
    const p2 = executor.executeReplacement('iron_pickaxe');

    // Second concurrent call should be rejected instantly with false.
    await expect(p2).resolves.toBe(false);

    executor.stop();
    await p1;
  });
});
