import type { ToolImpl } from '../types';

const HOSTILE_NAMES = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'witch', 'enderman',
  'pillager', 'vindicator', 'husk', 'drowned', 'phantom', 'slime',
  'magma_cube', 'blaze', 'ghast', 'silverfish', 'zombie_villager',
  'wither_skeleton', 'stray', 'guardian', 'elder_guardian', 'hoglin',
  'piglin', 'piglin_brute', 'zoglin', 'evoker', 'ravager', 'warden'
]);

export const getEntitiesTool: ToolImpl = {
  schema: {
    name: 'get_entities',
    description: 'List entities within a radius of the bot. Returns id, name, type, position, distance, and isHostile/isPlayer flags.',
    inputSchema: {
      type: 'object',
      properties: {
        radius: { type: 'number', minimum: 1, maximum: 128 }
      },
      required: []
    }
  },
  async execute(input, ctx) {
    const radius = typeof (input as any)?.radius === 'number' ? (input as any).radius : 32;
    const self = ctx.bot?.entity?.position;
    if (!self) return { ok: false, error: 'bot position unavailable' };
    const entities = ctx.bot?.entities;
    if (!entities || typeof entities !== 'object') {
      return { ok: true, data: { entities: [] } };
    }

    const results: any[] = [];
    for (const key of Object.keys(entities)) {
      const e = entities[key];
      if (!e || !e.position) continue;
      if (ctx.bot?.entity && e === ctx.bot.entity) continue;
      const dx = e.position.x - self.x;
      const dy = e.position.y - self.y;
      const dz = e.position.z - self.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance > radius) continue;

      const isPlayer = e.type === 'player' || typeof e.username === 'string';
      const name: string | undefined = isPlayer ? (e.username ?? e.name) : e.name;
      const isHostile = typeof name === 'string' && HOSTILE_NAMES.has(name);

      const entry: any = {
        id: e.id,
        name,
        type: e.type,
        position: { x: e.position.x, y: e.position.y, z: e.position.z },
        distance,
        isPlayer,
        isHostile
      };
      if (typeof e.health === 'number') entry.health = e.health;
      results.push(entry);
    }
    results.sort((a, b) => a.distance - b.distance);
    return { ok: true, data: { entities: results } };
  }
};
