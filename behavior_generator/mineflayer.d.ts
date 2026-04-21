// behavior_generator/mineflayer.d.ts
import type { Pathfinder } from 'mineflayer-pathfinder';
import type { PVP } from 'mineflayer-pvp/lib/PVP';

declare module 'mineflayer' {
  interface Bot {
    pathfinder: Pathfinder;
    pvp: PVP;
  }
}

export {};
