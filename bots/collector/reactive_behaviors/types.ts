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

export type ReactiveBehaviorStopReason = 'completed' | 'aborted' | 'preempted';

export interface ReactiveBehaviorState {
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
