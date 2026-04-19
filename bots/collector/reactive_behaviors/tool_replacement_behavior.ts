import { BehaviorIdle, NestedStateMachine, StateBehavior, StateTransition } from 'mineflayer-statemachine';
import { ReactiveBehavior, ReactiveBehaviorState, ReactiveBehaviorStopReason, Bot } from './types';
import { ToolReplacementExecutor } from '../tool_replacement_executor';
import { isWorkstationLocked } from '../../../utils/workstationLock';
import { getPersistentTools } from '../../../utils/persistentItemsConfig';
import { rank } from '../../../utils/items';
import logger from '../../../utils/logger';

const DURABLE_OTHER = ['bow', 'crossbow', 'fishing_rod', 'shears', 'flint_and_steel', 'trident'] as const;
const TOOL_TYPE_SUFFIXES = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'] as const;

interface ParsedTool {
  tier: string | null;
  type: string;
}

interface ToolInstance {
  name: string;
  tier: string | null;
  type: string;
  remainingRatio: number;
}

function parseToolName(name: string): ParsedTool | null {
  for (const type of TOOL_TYPE_SUFFIXES) {
    const suffix = `_${type}`;
    if (name.endsWith(suffix)) {
      const tier = name.slice(0, -suffix.length);
      return { tier, type };
    }
  }
  if ((DURABLE_OTHER as readonly string[]).includes(name)) {
    return { tier: null, type: name };
  }
  return null;
}

function remainingRatio(bot: Bot, item: any): number | null {
  const registryItems = (bot as any)?.registry?.items ?? {};
  const registryEntry = registryItems[item.type];
  const maxCandidate = registryEntry?.maxDurability ?? item.maxDurability;
  if (!Number.isFinite(maxCandidate) || maxCandidate <= 0) return null;
  const used = Number.isFinite(item.durabilityUsed) ? item.durabilityUsed : 0;
  const remaining = Math.max(0, maxCandidate - used);
  return remaining / maxCandidate;
}

function collectToolInstances(bot: Bot): ToolInstance[] {
  const watchNames = new Set<string>([
    ...getPersistentTools(),
    ...DURABLE_OTHER
  ]);
  watchNames.delete('shield');

  const out: ToolInstance[] = [];
  const items = bot.inventory?.items?.() || [];
  for (const it of items) {
    if (!it?.name || !watchNames.has(it.name)) continue;
    const parsed = parseToolName(it.name);
    if (!parsed) continue;
    const ratio = remainingRatio(bot, it);
    if (ratio === null) continue;
    const count = Number.isFinite(it.count) ? it.count : 1;
    for (let i = 0; i < count; i++) {
      out.push({
        name: it.name,
        tier: parsed.tier,
        type: parsed.type,
        remainingRatio: ratio
      });
    }
  }
  return out;
}

function findReplacementTarget(
  bot: Bot,
  threshold: number,
  toolsBeingReplaced: Set<string>
): string | null {
  const instances = collectToolInstances(bot);
  if (instances.length === 0) return null;

  const byType = new Map<string, ToolInstance[]>();
  for (const inst of instances) {
    const list = byType.get(inst.type) ?? [];
    list.push(inst);
    byType.set(inst.type, list);
  }

  for (const [, group] of byType) {
    let bestRank = -Infinity;
    let bestName: string | null = null;
    for (const inst of group) {
      const r = inst.tier === null ? 0 : rank(inst.name);
      if (r > bestRank) {
        bestRank = r;
        bestName = inst.name;
      }
    }
    if (!bestName) continue;
    if (toolsBeingReplaced.has(bestName)) continue;

    const sameName = group.filter(i => i.name === bestName);
    const hasSpare = sameName.some(i => i.remainingRatio >= threshold);
    if (hasSpare) continue;

    return bestName;
  }
  return null;
}

class DispatchState implements StateBehavior {
  public stateName = 'ToolReplacementDispatch';
  public active = false;
  private done = false;

  constructor(
    private readonly executor: ToolReplacementExecutor,
    private readonly toolName: string,
    private readonly safeChat: ((msg: string) => void) | null
  ) {}

  onStateEntered(): void {
    this.active = true;
    if (this.done) return;
    if (this.safeChat) {
      try { this.safeChat(`tool low, replacing ${this.toolName}`); } catch (_) {}
    }
    // Fire-and-forget: queue the replacement on the tool layer and exit
    // immediately. We must NOT await the promise here — the reactive layer
    // has priority over the tool layer in the control stack, so awaiting
    // would deadlock (tool layer can't run while reactive is busy). The
    // executor runs on its own lifecycle once the reactive layer releases
    // control; the `toolsBeingReplaced` Set prevents re-dispatch on the
    // next scheduler tick. Failure is logged by the executor.
    this.executor.executeReplacement(this.toolName).catch((err: any) => {
      logger.debug(`ToolReplacement: dispatch rejected — ${err?.message || err}`);
    });
    this.done = true;
  }

  onStateExited(): void {
    this.active = false;
  }

  isFinished(): boolean { return this.done; }
  wasSuccessful(): boolean { return true; }
}

function buildDispatchStateMachine(
  executor: ToolReplacementExecutor,
  toolName: string,
  safeChat: ((msg: string) => void) | null
): ReactiveBehaviorState {
  const enter = new BehaviorIdle();
  const dispatch = new DispatchState(executor, toolName, safeChat);
  const exit = new BehaviorIdle();

  const transitions = [
    new StateTransition({
      parent: enter,
      child: dispatch,
      name: 'tool-replacement: enter -> dispatch',
      shouldTransition: () => true
    }),
    new StateTransition({
      parent: dispatch,
      child: exit,
      name: 'tool-replacement: dispatch -> exit',
      shouldTransition: () => dispatch.isFinished()
    })
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  return {
    stateMachine,
    isFinished: () => dispatch.isFinished(),
    wasSuccessful: () => dispatch.wasSuccessful(),
    onStop: (_reason: ReactiveBehaviorStopReason) => {
      // Executor lifecycle is independent of the reactive NSM; nothing to tear down.
    }
  };
}

export interface ToolReplacementBehaviorDeps {
  executor: ToolReplacementExecutor;
  toolsBeingReplaced: Set<string>;
  durabilityThreshold: number;
}

export function createToolReplacementBehavior(deps: ToolReplacementBehaviorDeps): ReactiveBehavior {
  const { executor, toolsBeingReplaced, durabilityThreshold } = deps;
  let pendingTarget: string | null = null;

  return {
    priority: 70,
    name: 'tool_replacement',
    shouldActivate: (bot: Bot): boolean => {
      if (isWorkstationLocked()) return false;
      const target = findReplacementTarget(bot, durabilityThreshold, toolsBeingReplaced);
      pendingTarget = target;
      return target !== null;
    },
    createState: async (bot: Bot): Promise<ReactiveBehaviorState | null> => {
      if (!pendingTarget) return null;
      const tool = pendingTarget;
      pendingTarget = null;
      const safeChat: ((msg: string) => void) | null =
        typeof (bot as any)?.safeChat === 'function' ? (bot as any).safeChat.bind(bot) : null;
      return buildDispatchStateMachine(executor, tool, safeChat);
    }
  };
}
