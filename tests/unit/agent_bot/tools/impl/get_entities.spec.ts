import { getEntitiesTool } from '../../../../../bots/agent_bot/tools/impl/get_entities';

describe('get_entities', () => {
  const mkCtx = (bot: any) => ({
    bot, signal: new AbortController().signal,
    targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
  });

  it('lists nearby entities with distance and flags', async () => {
    const bot: any = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      entities: {
        1: { id: 1, name: 'cow', type: 'mob', position: { x: 3, y: 64, z: 4 }, health: 10 },
        2: { id: 2, name: 'zombie', type: 'hostile', position: { x: 0, y: 64, z: 5 }, health: 20 },
        3: { id: 3, username: 'alice', type: 'player', position: { x: 1, y: 64, z: 1 }, health: 20 }
      }
    };
    const r = await getEntitiesTool.execute({ radius: 10 }, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const list = (r.data as any).entities as any[];
    expect(list.length).toBe(3);
    const cow = list.find(e => e.id === 1);
    expect(cow.distance).toBeCloseTo(5, 5);
    expect(cow.isHostile).toBe(false);
    expect(cow.isPlayer).toBe(false);
    const zombie = list.find(e => e.id === 2);
    expect(zombie.isHostile).toBe(true);
    const player = list.find(e => e.id === 3);
    expect(player.isPlayer).toBe(true);
    expect(player.name).toBe('alice');
  });

  it('filters entities beyond radius', async () => {
    const bot: any = {
      entity: { position: { x: 0, y: 0, z: 0 } },
      entities: {
        1: { id: 1, name: 'cow', type: 'mob', position: { x: 100, y: 0, z: 0 } }
      }
    };
    const r = await getEntitiesTool.execute({ radius: 32 }, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).entities).toEqual([]);
  });

  it('defaults radius to 32', async () => {
    const bot: any = {
      entity: { position: { x: 0, y: 0, z: 0 } },
      entities: {
        1: { id: 1, name: 'cow', type: 'mob', position: { x: 50, y: 0, z: 0 } }
      }
    };
    const r = await getEntitiesTool.execute({}, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).entities).toEqual([]);
  });
});
