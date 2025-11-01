import { EventEmitter } from 'events';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
  clone?: () => Vec3Like;
  offset?: (dx: number, dy: number, dz: number) => Vec3Like;
  distanceTo?: (o: Vec3Like) => number;
}

export function createRotationBot(options?: {
  position?: Vec3Like;
  yaw?: number;
  pitch?: number;
  entities?: Record<string, any>;
}): any {
  const bot = new EventEmitter() as any;
  bot.version = '1.20.1';
  
  const pos = options?.position || { x: 0, y: 64, z: 0 };
  bot.entity = {
    position: {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      clone: () => ({ ...bot.entity.position }),
      distanceTo: (o: Vec3Like) => {
        const dx = bot.entity.position.x - o.x;
        const dy = bot.entity.position.y - o.y;
        const dz = bot.entity.position.z - o.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    },
    yaw: options?.yaw ?? 0,
    pitch: options?.pitch ?? 0
  };

  // Track look calls
  const lookCalls: Array<{ yaw: number; pitch: number; force: boolean }> = [];
  bot.look = (yaw: number, pitch: number, force: boolean = false) => {
    lookCalls.push({ yaw, pitch, force });
    bot.entity.yaw = yaw;
    bot.entity.pitch = pitch;
  };
  bot.lookCalls = lookCalls;

  // Mock entities
  bot.entities = options?.entities || {};

  // Mock attack
  const attackCalls: any[] = [];
  bot.attack = (entity: any) => {
    attackCalls.push(entity);
    return Promise.resolve();
  };
  bot.attackCalls = attackCalls;

  // Mock inventory
  bot.inventory = {
    slots: [],
    items: () => []
  };

  return bot;
}

export function createMockEntity(options: {
  id?: number;
  name?: string;
  position?: Vec3Like;
  width?: number;
  height?: number;
}): any {
  return {
    id: options.id ?? 1,
    name: options.name ?? 'zombie',
    displayName: options.name ?? 'zombie',
    position: options.position || { x: 10, y: 64, z: 0 },
    width: options.width ?? 0.6,
    height: options.height ?? 1.8
  };
}

export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

export function anglesDifferenceInDegrees(angle1: number, angle2: number): number {
  const diff = Math.abs(normalizeAngle(angle1) - normalizeAngle(angle2));
  return (diff * 180) / Math.PI;
}

export function waitForCondition(
  condition: () => boolean,
  timeoutMs: number = 5000,
  checkIntervalMs: number = 50
): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, checkIntervalMs);
  });
}

