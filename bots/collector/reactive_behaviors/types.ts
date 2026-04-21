export interface Bot {
  version?: string;
  entity?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
    position: any;
    health?: number;
    yaw: number;
    pitch: number;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  entities?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  pvp?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  lookAt?: (position: any, force?: boolean, callback?: () => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  on: (event: string, listener: (...args: any[]) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  off: (event: string, listener: (...args: any[]) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  [key: string]: any;
}

export type ReactiveBehaviorStopReason = 'completed' | 'aborted' | 'preempted';

export interface ReactiveBehaviorState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  stateMachine: any;
  isFinished?: () => boolean;
  wasSuccessful?: () => boolean;
  onStop?: (reason: ReactiveBehaviorStopReason) => void;
}

export interface ReactiveBehavior {
  priority: number;
  name: string;
  shouldActivate: (bot: Bot) => Promise<boolean> | boolean;
  createState: (bot: Bot) => Promise<ReactiveBehaviorState | null> | ReactiveBehaviorState | null;
}
