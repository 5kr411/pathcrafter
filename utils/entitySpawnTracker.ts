/**
 * Tracks when entities spawn so we can determine entity freshness.
 * The Minecraft protocol doesn't expose server-side entity age,
 * so we record spawn times client-side via the entitySpawn event.
 */

interface EntityLike {
  id?: number;
  [key: string]: any;
}

interface BotLike {
  on?: (event: string, handler: (entity: EntityLike) => void) => void;
  removeListener?: (event: string, handler: (entity: EntityLike) => void) => void;
  [key: string]: any;
}

const PRUNE_AGE_MS = 60000;

export class EntitySpawnTracker {
  private spawnTimes = new Map<number, number>();
  private handler: ((entity: EntityLike) => void) | null = null;
  private bot: BotLike | null = null;

  attach(bot: BotLike): void {
    this.detach();
    this.bot = bot;
    this.spawnTimes.clear();
    this.handler = (entity: EntityLike) => {
      if (entity && entity.id != null) {
        this.spawnTimes.set(entity.id, Date.now());
      }
    };
    if (typeof bot.on === 'function') {
      bot.on('entitySpawn', this.handler);
    }
  }

  detach(): void {
    if (this.bot && this.handler && typeof this.bot.removeListener === 'function') {
      this.bot.removeListener('entitySpawn', this.handler);
    }
    this.handler = null;
    this.bot = null;
    this.spawnTimes.clear();
  }

  /** Returns the recorded spawn time for an entity, or undefined if unknown. */
  getSpawnTime(entityId: number): number | undefined {
    return this.spawnTimes.get(entityId);
  }

  /** Returns true if the entity spawned after the given timestamp. */
  spawnedAfter(entityId: number, timestamp: number): boolean {
    const spawnTime = this.spawnTimes.get(entityId);
    if (spawnTime === undefined) return true; // Unknown — allow by default
    return spawnTime >= timestamp;
  }

  /** Remove entries older than PRUNE_AGE_MS to prevent unbounded growth. */
  prune(): void {
    const cutoff = Date.now() - PRUNE_AGE_MS;
    for (const [id, time] of this.spawnTimes) {
      if (time < cutoff) this.spawnTimes.delete(id);
    }
  }
}
