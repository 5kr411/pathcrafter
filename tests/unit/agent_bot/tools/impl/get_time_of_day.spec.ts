import { getTimeOfDayTool } from '../../../../../bots/agent_bot/tools/impl/get_time_of_day';

describe('get_time_of_day', () => {
  const mkCtx = (bot: any) => ({
    bot, signal: new AbortController().signal,
    targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
  });

  it.each([
    [0, 'day'],
    [11999, 'day'],
    [12000, 'dusk'],
    [13799, 'dusk'],
    [13800, 'night'],
    [22199, 'night'],
    [22200, 'dawn'],
    [23999, 'dawn']
  ])('ticks=%i -> phase=%s', async (ticks, phase) => {
    const r = await getTimeOfDayTool.execute({}, mkCtx({ time: { timeOfDay: ticks } }) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any)).toEqual({ ticks, phase });
  });
});
