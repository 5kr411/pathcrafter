import { EventEmitter } from 'events';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
  clone: () => Vec3Like;
  offset: (dx: number, dy: number, dz: number) => Vec3Like;
  floored: () => Vec3Like;
  floor?: () => Vec3Like; // compat for BehaviorFindInteractPosition
  distanceTo: (o: Vec3Like) => number;
  manhattanDistanceTo?: (o: Vec3Like) => number;
  toString?: () => string;
}

export interface FakeBlock {
  type: number;
  name?: string;
  position: Vec3Like;
  boundingBox: 'empty' | 'block';
}

export interface FakeWorld extends EventEmitter {
  getBlockType(pos: Vec3Like): number;
  setBlockType(pos: Vec3Like, type: number): void;
}

export interface FakeBot extends EventEmitter {
  version?: string;
  entity: { position: Vec3Like };
  world: FakeWorld;
  inventory: { slots: any[]; items: () => any[] };
  pathfinder: { setMovements: (_: any) => void; setGoal: (_: any) => void; isMoving: () => boolean };
  blockAt(pos: Vec3Like, _extra?: boolean): FakeBlock | null;
  canDigBlock?: (block: FakeBlock) => boolean;
  canSeeBlock?: (block: FakeBlock) => boolean;
  dig?: (block: FakeBlock) => Promise<void>;
  equip?: (_item: any, _where: string) => Promise<void>;
  placeBlock?: (ref: FakeBlock, face: Vec3Like) => Promise<void>;
  heldItem?: any;
  [key: string]: any;
}

function keyOf(pos: Vec3Like): string {
  return `${pos.x}|${pos.y}|${pos.z}`;
}

function vec3(x: number, y: number, z: number): Vec3Like {
  return {
    x,
    y,
    z,
    clone() {
      return vec3(this.x, this.y, this.z);
    },
    offset(dx: number, dy: number, dz: number) {
      this.x += dx;
      this.y += dy;
      this.z += dz;
      return this;
    },
    floored() {
      return vec3(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    },
    floor() {
      this.x = Math.floor(this.x);
      this.y = Math.floor(this.y);
      this.z = Math.floor(this.z);
      return this;
    },
    distanceTo(o: Vec3Like) {
      const dx = this.x - o.x;
      const dy = this.y - o.y;
      const dz = this.z - o.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },
    manhattanDistanceTo(o: Vec3Like) {
      return Math.abs(this.x - o.x) + Math.abs(this.y - o.y) + Math.abs(this.z - o.z);
    },
    toString() {
      return `(${this.x}, ${this.y}, ${this.z})`;
    }
  };
}

export function createFakeWorld(initial: Record<string, number> = {}): FakeWorld {
  const world = new EventEmitter() as FakeWorld;
  const map = new Map<string, number>(Object.entries(initial));
  world.getBlockType = (pos: Vec3Like): number => {
    return map.get(keyOf(pos)) ?? 0; // 0 = air
  };
  world.setBlockType = (pos: Vec3Like, type: number): void => {
    const k = keyOf(pos);
    const oldType = map.get(k) ?? 0;
    map.set(k, type);
    world.emit(`blockUpdate:(${pos.x}, ${pos.y}, ${pos.z})`, { type: oldType, position: pos }, { type, position: pos });
  };
  return world;
}

export function createFakeBot(options?: {
  position?: { x: number; y: number; z: number };
  worldInit?: Record<string, number>;
  canDig?: boolean;
}): FakeBot {
  const bot = new EventEmitter() as FakeBot;
  bot.version = '1.20.1';
  bot.entity = { position: vec3(options?.position?.x ?? 0, options?.position?.y ?? 0, options?.position?.z ?? 0) };
  bot.world = createFakeWorld(options?.worldInit);
  bot.inventory = { slots: [], items: () => [] };
  
  try {
    const minecraftData = require('minecraft-data');
    const mcDataObj = minecraftData(bot.version);
    bot.mcData = mcDataObj;
    
    (global as any).mcData = () => mcDataObj;
  } catch (_err) {
    // minecraft-data not available in test
  }

  let moving = false;
  bot.pathfinder = {
    setMovements: () => {},
    setGoal: (_goal: any) => {
      moving = true;
      setTimeout(() => {
        moving = false;
        (bot as any).emit('goal_reached');
      }, 0);
    },
    isMoving: () => moving
  };

  bot.blockAt = (_pos: Vec3Like): FakeBlock | null => {
    const pos = vec3(_pos.x, _pos.y, _pos.z);
    const type = bot.world.getBlockType(pos);
    const boundingBox = type === 0 ? 'empty' : 'block';
    return { type, position: pos, boundingBox };
  };
  bot.canSeeBlock = () => true;
  if (options?.canDig !== undefined) {
    bot.canDigBlock = () => options.canDig as boolean;
  } else {
    bot.canDigBlock = () => true;
  }
  bot.dig = async (block: FakeBlock): Promise<void> => {
    // Simulate instant dig to air
    bot.world.setBlockType(block.position, 0);
  };
  bot.equip = async (): Promise<void> => {};
  bot.placeBlock = async (ref: FakeBlock, face: Vec3Like): Promise<void> => {
    const dest = vec3(ref.position.x + face.x, ref.position.y + face.y, ref.position.z + face.z);
    bot.world.setBlockType(dest, 1);
  };
  
  // Mock mineflayer-tool plugin
  bot.tool = {
    equipForBlock: async (_block: FakeBlock, _options?: { requireHarvest?: boolean }): Promise<void> => {}
  };
  
  return bot;
}


