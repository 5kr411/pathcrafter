export interface Bot {
  version?: string;
  entity?: {
    position: any;
    health?: number;
    yaw: number;
    pitch: number;
  };
  entities?: Record<string, any>;
  pvp?: any;
  lookAt?: (position: any, force?: boolean, callback?: () => void) => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
  off: (event: string, listener: (...args: any[]) => void) => void;
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
  [key: string]: any;
}

export interface ReactiveBehavior {
  priority: number;
  name: string;
  shouldActivate: (bot: Bot) => Promise<boolean> | boolean;
  execute: (bot: Bot, executor: ReactiveBehaviorExecutor) => Promise<any>;
  onDeactivate?: () => void;
}

export interface ReactiveBehaviorExecutor {
  finish(success: boolean): void;
}

