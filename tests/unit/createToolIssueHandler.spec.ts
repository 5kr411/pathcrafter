import { createToolIssueHandler } from '../../bots/collector/target_executor';
import { ToolIssue } from '../../bots/collector/execution_context';
import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';

describe('createToolIssueHandler', () => {
  const baseBot = { inventory: { items: () => [] } } as any;

  function makeScheduler() {
    let scheduled: Promise<any> | null = null;
    const schedule = (fn: () => void) => {
      scheduled = Promise.resolve().then(() => fn());
    };
    return { schedule, wait: () => scheduled || Promise.resolve() };
  }

  test('handles missing-tool requirement with distinct chat and executes replacement', async () => {
    const safeChat = jest.fn();
    const executeReplacement = jest.fn().mockResolvedValue(true);
    const toolsBeingReplaced = new Set<string>();
    const scheduler = makeScheduler();

    const handler = createToolIssueHandler({
      toolReplacementExecutor: { executeReplacement } as unknown as ToolReplacementExecutor,
      toolsBeingReplaced,
      bot: baseBot,
      safeChat,
      schedule: scheduler.schedule
    });

    const issue: ToolIssue = {
      type: 'requirement',
      toolName: 'iron_pickaxe',
      blockName: 'iron_ore',
      currentToolName: 'hand'
    };

    handler(issue);
    await scheduler.wait();

    expect(executeReplacement).toHaveBeenCalledWith('iron_pickaxe');
    expect(safeChat).toHaveBeenCalledWith('missing tool, acquiring iron_pickaxe');
    expect(safeChat).toHaveBeenCalledWith('acquired iron_pickaxe');
    expect(toolsBeingReplaced.has('iron_pickaxe')).toBe(false);
  });

  test('handles durability issues with replacement flow', async () => {
    const safeChat = jest.fn();
    const executeReplacement = jest.fn().mockResolvedValue(true);
    const toolsBeingReplaced = new Set<string>();
    const scheduler = makeScheduler();

    const handler = createToolIssueHandler({
      toolReplacementExecutor: { executeReplacement } as unknown as ToolReplacementExecutor,
      toolsBeingReplaced,
      bot: baseBot,
      safeChat,
      schedule: scheduler.schedule
    });

    const issue: ToolIssue = {
      type: 'durability',
      toolName: 'stone_pickaxe',
      currentToolName: 'stone_pickaxe'
    };

    handler(issue);
    await scheduler.wait();

    expect(executeReplacement).toHaveBeenCalledWith('stone_pickaxe');
    expect(safeChat).toHaveBeenCalledWith('tool low, replacing stone_pickaxe');
    expect(safeChat).toHaveBeenCalledWith('replaced stone_pickaxe');
    expect(toolsBeingReplaced.size).toBe(0);
  });

  test('ignores tool issues without a tool name', async () => {
    const safeChat = jest.fn();
    const executeReplacement = jest.fn().mockResolvedValue(true);
    const toolsBeingReplaced = new Set<string>();
    const scheduler = makeScheduler();

    const handler = createToolIssueHandler({
      toolReplacementExecutor: { executeReplacement } as unknown as ToolReplacementExecutor,
      toolsBeingReplaced,
      bot: baseBot,
      safeChat,
      schedule: scheduler.schedule
    });

    const issue: ToolIssue = {
      type: 'durability',
      toolName: '',
      currentToolName: 'stone_pickaxe'
    };

    handler(issue);
    await scheduler.wait();

    expect(executeReplacement).not.toHaveBeenCalled();
    expect(safeChat).not.toHaveBeenCalled();
    expect(toolsBeingReplaced.size).toBe(0);
  });
});
