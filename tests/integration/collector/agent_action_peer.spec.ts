import { CollectorControlStack } from '../../../bots/collector/control_stack';
import { ReactiveBehaviorRegistry } from '../../../bots/collector/reactive_behavior_registry';
import { AgentActionExecutor, type AgentAction } from '../../../bots/agent_bot/action_executor';
import type { ToolResult } from '../../../bots/agent_bot/tools/types';
import { createSimulatedBot, SimulatedClock } from '../../helpers/reactiveTestHarness';
import { TestWorkerManager } from '../../helpers/schedulerTestUtils';

const CONFIG = {
  snapshotRadii: [32],
  snapshotYHalf: null,
  pruneWithWorld: true,
  combineSimilarNodes: false,
  perGenerator: 1,
  toolDurabilityThreshold: 0.3
};

function makeStack(bot: any, agentLayer: any | null): CollectorControlStack {
  const registry = new ReactiveBehaviorRegistry();
  const workerManager = new TestWorkerManager();
  return new CollectorControlStack(
    bot,
    workerManager as any,
    bot.safeChat ?? (() => {}),
    CONFIG,
    registry,
    agentLayer
  );
}

describe('CollectorControlStack with AgentActionExecutor peer', () => {
  let originalDateNow: () => number;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    originalDateNow = Date.now;
  });

  afterEach(() => {
    jest.useRealTimers();
    (Date as any).now = originalDateNow;
  });

  it('builds without an agentActionLayer (backward compatibility)', () => {
    const bot = createSimulatedBot();
    const stack = makeStack(bot, null);
    expect(stack.agentActionLayer).toBeNull();
    stack.start();
    stack.stop();
  });

  it('transitions into agent_action when only the agent layer has work', async () => {
    const bot = createSimulatedBot();
    const agent = new AgentActionExecutor(bot);
    const stack = makeStack(bot, agent);
    stack.start();
    // Disable reactive polling so it never reports work.
    stack.reactiveLayer.setEnabled(false);

    const clock = new SimulatedClock(bot, 50, 0);

    // No work → agent layer idle.
    await clock.tick(1);
    expect(agent.active).toBe(false);
    expect(agent.hasWork()).toBe(false);

    // Queue an action that runs until externally stopped.
    const action: AgentAction = {
      name: 'long',
      start: () => {},
      update: () => {},
      stop: () => {},
      isFinished: () => false,
      result: () => ({ ok: true })
    };
    const p = agent.run(action, new AbortController().signal);

    // Tick until the state machine transitions.
    await clock.waitFor(() => agent.active === true, 2000);
    expect(agent.active).toBe(true);

    // Cleanup: stop the executor, which resolves p.
    agent.stop();
    await p;

    stack.stop();
  });

  it('target wins over agent_action when both have work', async () => {
    const bot = createSimulatedBot();
    const agent = new AgentActionExecutor(bot);
    const stack = makeStack(bot, agent);
    stack.start();
    stack.reactiveLayer.setEnabled(false);

    // Give the agent layer work.
    const action: AgentAction = {
      name: 'long',
      start: () => {},
      update: () => {},
      stop: () => {},
      isFinished: () => false,
      result: () => ({ ok: true })
    };
    const p = agent.run(action, new AbortController().signal);

    // Give the target layer work too by stubbing hasWork on the target layer.
    const targetHasWork = jest.spyOn(stack.targetLayer, 'hasWork').mockReturnValue(true);
    // Prevent target layer from doing anything real by stubbing entry points.
    jest.spyOn(stack.targetLayer, 'onStateEntered').mockImplementation(() => {
      (stack.targetLayer as any).active = true;
    });
    jest.spyOn(stack.targetLayer, 'update').mockImplementation(() => {});
    jest.spyOn(stack.targetLayer, 'onStateExited').mockImplementation(() => {
      (stack.targetLayer as any).active = false;
    });

    const clock = new SimulatedClock(bot, 50, 0);
    await clock.waitFor(() => (stack.targetLayer as any).active === true, 2000);

    // Agent must not be active while target has work.
    expect((stack.targetLayer as any).active).toBe(true);
    expect(agent.active).toBe(false);

    // Let the agent action resolve via preemption/stop.
    targetHasWork.mockReturnValue(false);
    agent.stop();
    await p;

    stack.stop();
  });

  it('reactive preempts an active agent action', async () => {
    const bot = createSimulatedBot();
    const agent = new AgentActionExecutor(bot);
    const stack = makeStack(bot, agent);
    stack.start();
    stack.reactiveLayer.setEnabled(false);

    const stopSpy = jest.fn();
    const action: AgentAction = {
      name: 'long',
      start: () => {},
      update: () => {},
      stop: stopSpy,
      isFinished: () => false,
      result: () => ({ ok: true })
    };
    const p = agent.run(action, new AbortController().signal);

    const clock = new SimulatedClock(bot, 50, 0);
    await clock.waitFor(() => agent.active === true, 2000);
    expect(agent.active).toBe(true);

    // Reactive layer now claims work.
    const reactiveHasWork = jest.spyOn(stack.reactiveLayer, 'hasWork').mockReturnValue(true);
    jest.spyOn(stack.reactiveLayer, 'onStateEntered').mockImplementation(() => {
      (stack.reactiveLayer as any).active = true;
    });
    jest.spyOn(stack.reactiveLayer, 'update').mockImplementation(() => {});
    jest.spyOn(stack.reactiveLayer, 'onStateExited').mockImplementation(() => {
      (stack.reactiveLayer as any).active = false;
    });

    await clock.waitFor(() => agent.active === false, 2000);
    expect(agent.active).toBe(false);
    // The action was preempted — stop was called.
    const r = (await p) as ToolResult;
    expect(stopSpy).toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect((r as { preempted?: boolean }).preempted).toBe(true);

    reactiveHasWork.mockReturnValue(false);
    stack.stop();
  });
});
