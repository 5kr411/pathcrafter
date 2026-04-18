import type { ToolImpl } from '../types';

function phaseOf(ticks: number): string {
  if (ticks < 12000) return 'day';
  if (ticks < 13800) return 'dusk';
  if (ticks < 22200) return 'night';
  return 'dawn';
}

export const getTimeOfDayTool: ToolImpl = {
  schema: {
    name: 'get_time_of_day',
    description: 'Returns the current in-game time of day as {ticks, phase} where phase is day|dusk|night|dawn.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  async execute(_input, ctx) {
    const raw = ctx.bot?.time?.timeOfDay;
    const ticks = typeof raw === 'number' ? raw : 0;
    return { ok: true, data: { ticks, phase: phaseOf(ticks) } };
  }
};
