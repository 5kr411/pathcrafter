import { ToolExecutor } from '../../../../bots/agent_bot/tools/executor';
import type { ToolImpl } from '../../../../bots/agent_bot/tools/types';

describe('ToolExecutor', () => {
  const mockTool: ToolImpl = {
    schema: { name: 'mock', description: 'x', inputSchema: { type: 'object', properties: {}, required: [] } },
    execute: jest.fn().mockResolvedValue({ ok: true, data: { x: 1 } })
  };
  const ctx: any = { bot: {}, signal: new AbortController().signal, targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {} };

  it('dispatches a known tool', async () => {
    const exec = new ToolExecutor([mockTool]);
    const r = await exec.run({ id: 'c1', name: 'mock', input: {} }, ctx);
    expect(r).toEqual({ ok: true, data: { x: 1 } });
  });

  it('errors on unknown tool', async () => {
    const exec = new ToolExecutor([mockTool]);
    const r = await exec.run({ id: 'c1', name: 'nope', input: {} }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown tool/);
  });

  it('exposes schemas', () => {
    const exec = new ToolExecutor([mockTool]);
    expect(exec.schemas()).toEqual([mockTool.schema]);
  });

  it('catches thrown errors into {ok:false}', async () => {
    const throwingTool: ToolImpl = {
      schema: { name: 'boom', description: 'x', inputSchema: { type: 'object', properties: {}, required: [] } },
      execute: jest.fn().mockRejectedValue(new Error('kaboom'))
    };
    const exec = new ToolExecutor([throwingTool]);
    const r = await exec.run({ id: 'c2', name: 'boom', input: {} }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/kaboom/);
  });

  it('marks cancelled when signal aborted', async () => {
    const ctrl = new AbortController();
    const hangingTool: ToolImpl = {
      schema: { name: 'hang', description: 'x', inputSchema: { type: 'object', properties: {}, required: [] } },
      execute: jest.fn().mockImplementation(async () => { throw new Error('aborted'); })
    };
    ctrl.abort();
    const ctxA: any = { bot: {}, signal: ctrl.signal, targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {} };
    const exec = new ToolExecutor([hangingTool]);
    const r = await exec.run({ id: 'c3', name: 'hang', input: {} }, ctxA);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.cancelled).toBe(true); expect(r.error).toBe('cancelled'); }
  });
});
