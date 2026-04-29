import { BehaviorIdle, NestedStateMachine, StateTransition } from 'mineflayer-statemachine';
import { Bot } from './config';
import { WorkerManager } from './worker_manager';
import { ReactiveBehaviorRegistry } from './reactive_behavior_registry';
import { ReactiveBehaviorManager } from './reactive_behavior_manager';
import { ToolReplacementExecutor } from './tool_replacement_executor';
import { TargetExecutor } from './target_executor';
import { StateMachineRunner } from './state_machine_runner';
import { setWorkstationPhaseProvider } from '../../utils/workstationLock';
import logger from '../../utils/logger';

export type ControlMode = 'idle' | 'reactive' | 'tool' | 'target' | 'agent_action';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  readonly agentActionLayer: any | null;
  readonly rootStateMachine: NestedStateMachine;

  public readonly toolsBeingReplaced = new Set<string>();

  constructor(
    private readonly bot: Bot,
    private readonly workerManager: WorkerManager,
    private readonly safeChat: (msg: string) => void,
    private readonly config: ControlStackConfig,
    reactiveRegistry: ReactiveBehaviorRegistry,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    agentActionLayer: any | null = null
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
    this.agentActionLayer = agentActionLayer;

    setWorkstationPhaseProvider(() => this.targetLayer.isInWorkstationPhase());

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
    if (this.agentActionLayer && typeof this.agentActionLayer.stop === 'function') {
      try { this.agentActionLayer.stop(); } catch (_) {}
    }
    this.runner.stop();
  }

  private createRootStateMachine(): NestedStateMachine {
    const idle = new BehaviorIdle();
    const reactive = this.reactiveLayer;
    const tool = this.toolLayer;
    const target = this.targetLayer;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    const states: any[] = [idle, reactive, tool, target];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    const modeByState = new Map<any, ControlMode>([
      [idle, 'idle'],
      [reactive, 'reactive'],
      [tool, 'tool'],
      [target, 'target']
    ]);
    if (this.agentActionLayer) {
      states.push(this.agentActionLayer);
      modeByState.set(this.agentActionLayer, 'agent_action');
    }

    const transitions: StateTransition[] = [];

    for (const parent of states) {
      for (const child of states) {
        if (parent === child) continue;
        const fromMode = modeByState.get(parent)!;
        const toMode = modeByState.get(child)!;
        transitions.push(
          new StateTransition({
            parent,
            child,
            name: `control: ${fromMode} -> ${toMode}`,
            shouldTransition: () => this.getDesiredMode() === toMode,
            onTransition: () => {
              // Only log non-idle transitions to avoid spam
              if (fromMode !== 'idle' || toMode !== 'idle') {
                logger.info(`ControlStack: ${fromMode} -> ${toMode}`);
              }
            }
          })
        );
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    return new NestedStateMachine(transitions, idle, null as any);
  }

  getDesiredMode(): ControlMode {
    if (this.reactiveLayer.hasWork()) return 'reactive';
    if (this.toolLayer.hasWork()) return 'tool';
    if (this.targetLayer.hasWork()) return 'target';
    if (this.agentActionLayer && typeof this.agentActionLayer.hasWork === 'function' && this.agentActionLayer.hasWork()) {
      return 'agent_action';
    }
    return 'idle';
  }
}
