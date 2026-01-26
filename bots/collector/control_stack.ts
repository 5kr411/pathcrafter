import { BehaviorIdle, NestedStateMachine, StateTransition } from 'mineflayer-statemachine';
import { Bot } from './config';
import { WorkerManager } from './worker_manager';
import { ReactiveBehaviorRegistry } from './reactive_behavior_registry';
import { ReactiveBehaviorManager } from './reactive_behavior_manager';
import { ToolReplacementExecutor } from './tool_replacement_executor';
import { TargetExecutor } from './target_executor';
import { StateMachineRunner } from './state_machine_runner';

export type ControlMode = 'idle' | 'reactive' | 'tool' | 'target';

export interface ControlStackConfig {
  snapshotRadii: number[];
  snapshotYHalf: number | null;
  pruneWithWorld: boolean;
  combineSimilarNodes: boolean;
  perGenerator: number;
  toolDurabilityThreshold: number;
}

export class CollectorControlStack {
  readonly runner: StateMachineRunner;
  readonly reactiveLayer: ReactiveBehaviorManager;
  readonly toolLayer: ToolReplacementExecutor;
  readonly targetLayer: TargetExecutor;
  readonly rootStateMachine: NestedStateMachine;

  private readonly toolsBeingReplaced = new Set<string>();

  constructor(
    private readonly bot: Bot,
    private readonly workerManager: WorkerManager,
    private readonly safeChat: (msg: string) => void,
    private readonly config: ControlStackConfig,
    reactiveRegistry: ReactiveBehaviorRegistry
  ) {
    this.reactiveLayer = new ReactiveBehaviorManager(this.bot, reactiveRegistry);
    this.toolLayer = new ToolReplacementExecutor(
      this.bot,
      this.workerManager,
      this.safeChat,
      this.config,
      this.toolsBeingReplaced
    );
    this.targetLayer = new TargetExecutor(
      this.bot,
      this.workerManager,
      this.safeChat,
      this.config,
      this.toolLayer,
      this.toolsBeingReplaced
    );

    this.rootStateMachine = this.createRootStateMachine();
    this.runner = new StateMachineRunner(this.bot, this.rootStateMachine);
  }

  start(): void {
    this.runner.start();
  }

  stop(): void {
    this.reactiveLayer.stop();
    this.toolLayer.stop();
    this.targetLayer.stop();
    this.runner.stop();
  }

  private createRootStateMachine(): NestedStateMachine {
    const idle = new BehaviorIdle();
    const reactive = this.reactiveLayer;
    const tool = this.toolLayer;
    const target = this.targetLayer;

    const states = [idle, reactive, tool, target];
    const modeByState = new Map<any, ControlMode>([
      [idle, 'idle'],
      [reactive, 'reactive'],
      [tool, 'tool'],
      [target, 'target']
    ]);

    const transitions: StateTransition[] = [];

    for (const parent of states) {
      for (const child of states) {
        if (parent === child) continue;
        transitions.push(
          new StateTransition({
            parent,
            child,
            name: `control: ${modeByState.get(parent)} -> ${modeByState.get(child)}`,
            shouldTransition: () => this.getDesiredMode() === modeByState.get(child)
          })
        );
      }
    }

    return new NestedStateMachine(transitions, idle, null as any);
  }

  private getDesiredMode(): ControlMode {
    if (this.reactiveLayer.hasWork()) return 'reactive';
    if (this.toolLayer.hasWork()) return 'tool';
    if (this.targetLayer.hasWork()) return 'target';
    return 'idle';
  }
}
