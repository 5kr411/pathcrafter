import type { ToolImpl } from '../types';
import { sleep } from './helpers/sleep';

type WaitInput = { seconds: number };

export const waitTool: ToolImpl<WaitInput> = {
  schema: {
    name: 'wait',
    description: 'Pause for a number of seconds. Useful when waiting for game state to change (mobs to move, day/night cycle, etc.).',
    inputSchema: {
      type: 'object',
      properties: { seconds: { type: 'number', minimum: 0, maximum: 600 } },
      required: ['seconds']
    }
  },
  async execute(input, ctx) {
    const seconds = input?.seconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      return { ok: false, error: 'seconds must be a non-negative number' };
    }
    try {
      await sleep(seconds * 1000, ctx.signal);
      return { ok: true };
    } catch (err) {
      if (ctx.signal.aborted) return { ok: false, error: 'cancelled', cancelled: true };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
};
