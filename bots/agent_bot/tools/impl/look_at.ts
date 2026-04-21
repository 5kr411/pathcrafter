import type { ToolImpl } from '../types';
import { Vec3 } from 'vec3';

type LookAtInput = {
  entityId?: number;
  x?: number;
  y?: number;
  z?: number;
};

export const lookAtTool: ToolImpl<LookAtInput> = {
  schema: {
    name: 'look_at',
    description: 'Make the bot look at a target. Provide either an entityId or explicit {x, y, z} coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' }
      },
      required: []
    }
  },
  async execute(input, ctx) {
    const i = input ?? {};
    let target: Vec3 | null = null;

    if (typeof i.entityId === 'number') {
      const ent = ctx.bot?.entities?.[i.entityId];
      if (!ent || !ent.position) return { ok: false, error: `entity ${i.entityId} not found` };
      target = new Vec3(ent.position.x, ent.position.y, ent.position.z);
    } else if (typeof i.x === 'number' && typeof i.y === 'number' && typeof i.z === 'number') {
      target = new Vec3(i.x, i.y, i.z);
    } else {
      return { ok: false, error: 'provide either entityId or x/y/z' };
    }

    if (typeof ctx.bot?.lookAt !== 'function') {
      return { ok: false, error: 'bot.lookAt unavailable' };
    }
    await ctx.bot.lookAt(target);
    return { ok: true };
  }
};
