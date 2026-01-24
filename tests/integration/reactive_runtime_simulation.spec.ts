import { EventEmitter } from 'events';
import { ScheduledBehavior } from '../../bots/collector/behavior_scheduler';
import { createTrackedBotStateMachine } from '../../bots/collector/state_machine_utils';
import { ReactiveTestHarness } from '../helpers/reactiveTestHarness';

function createTickingBehavior(bot: any, ticks: { count: number }, name: string): ScheduledBehavior {
  const stateMachine = new EventEmitter() as any;
  stateMachine.update = () => {
    ticks.count += 1;
  };
  stateMachine.onStateEntered = jest.fn();
  stateMachine.onStateExited = jest.fn();
  stateMachine.transitions = [];
  stateMachine.states = [];

  const tracked = createTrackedBotStateMachine(bot, stateMachine);
  const listener = tracked.listener.bind(bot);

  return {
    id: `test-${name}`,
    name,
    type: 'test',
    priority: 10,
    activate: async (context) => {
      context.attachStateMachine(tracked.botStateMachine, listener);
    },
    onSuspend: async (context) => {
      context.detachStateMachine();
    },
    onResume: async (context) => {
      context.attachStateMachine(tracked.botStateMachine, listener);
    },
    onAbort: async (context) => {
      context.detachStateMachine();
    }
  };
}

describe('integration: reactive runtime simulation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('suspends and resumes the base behavior around reactive execution', async () => {
    const harness = new ReactiveTestHarness({ pollIntervalMs: 100, tickMs: 50 });

    try {
      const baseTicks = { count: 0 };
      const baseBehavior = createTickingBehavior(harness.bot, baseTicks, 'base');

      await harness.startBehavior(baseBehavior);
      harness.enableReactivePolling();

      await harness.tick(4);
      expect(baseTicks.count).toBeGreaterThanOrEqual(4);

      let allowReactive = false;
      let reactiveTicks = 0;
      let reactiveFinished = false;

      harness.registry.register({
        name: 'reactive-test',
        priority: 100,
        shouldActivate: () => allowReactive,
        execute: async (_bot: any, executor: { finish: (success: boolean) => void }) => {
          const stateMachine = new EventEmitter() as any;
          stateMachine.update = () => {
            if (reactiveFinished) return;
            reactiveTicks += 1;
            if (reactiveTicks >= 6) {
              reactiveFinished = true;
              allowReactive = false;
              executor.finish(true);
            }
          };
          stateMachine.onStateEntered = jest.fn();
          stateMachine.onStateExited = jest.fn();
          stateMachine.transitions = [];
          stateMachine.states = [];
          return stateMachine;
        }
      });

      allowReactive = true;
      await harness.waitFor(() => harness.executor.isActive(), 1000);
      const ticksAtReactiveStart = baseTicks.count;

      await harness.waitFor(() => !harness.executor.isActive(), 2000);

      expect(reactiveTicks).toBeGreaterThanOrEqual(6);
      expect(baseTicks.count).toBe(ticksAtReactiveStart);

      await harness.waitFor(() => baseTicks.count > ticksAtReactiveStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('prevents overlapping reactive runs during continuous activation', async () => {
    const harness = new ReactiveTestHarness({ pollIntervalMs: 100, tickMs: 50 });

    try {
      const baseTicks = { count: 0 };
      const baseBehavior = createTickingBehavior(harness.bot, baseTicks, 'base');
      await harness.startBehavior(baseBehavior);

      let activeRuns = 0;
      let maxActive = 0;
      let runCount = 0;
      let reactiveTicks = 0;

      harness.registry.register({
        name: 'reactive-repeat',
        priority: 90,
        shouldActivate: () => true,
        execute: async (_bot: any, executor: { finish: (success: boolean) => void }) => {
          runCount += 1;
          activeRuns += 1;
          if (activeRuns > maxActive) maxActive = activeRuns;

          const stateMachine = new EventEmitter() as any;
          stateMachine.update = () => {
            reactiveTicks += 1;
          };
          stateMachine.onStateEntered = jest.fn();
          stateMachine.onStateExited = jest.fn();
          stateMachine.transitions = [];
          stateMachine.states = [];

          setTimeout(() => {
            activeRuns -= 1;
            executor.finish(true);
          }, 250);

          return stateMachine;
        }
      });

      harness.enableReactivePolling();

      await harness.advance(1200);
      harness.disableReactivePolling();
      await harness.waitFor(() => activeRuns === 0, 1000);

      expect(runCount).toBeGreaterThanOrEqual(2);
      expect(maxActive).toBe(1);
      expect(reactiveTicks).toBeGreaterThan(0);
    } finally {
      harness.disableReactivePolling();
    }
  });
});
