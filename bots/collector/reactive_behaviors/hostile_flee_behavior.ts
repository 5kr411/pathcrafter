import {
  BehaviorIdle,
  NestedStateMachine,
  StateTransition
} from 'mineflayer-statemachine';
import logger from '../../../utils/logger';
import { forceStopAllMovement } from '../../../utils/movement';
import { ReactiveBehavior, ReactiveBehaviorStopReason, Bot } from './types';
import {
  BehaviorCaptureThreat,
  BehaviorFleeVisible,
  BehaviorFleeFromMemory,
  FleeContext,
  HOSTILE_FLEE_PRIORITY,
  TRIGGER_RADIUS,
  hasUsableShield,
  getThreat
} from './hostile_flee_states';

export { FLEE_MEMORY_MS } from './hostile_flee_states';

export const hostileFleeBehavior: ReactiveBehavior = {
  priority: HOSTILE_FLEE_PRIORITY,
  name: 'hostile_flee',

  shouldActivate: (bot: Bot): boolean => {
    if (hasUsableShield(bot)) {
      return false;
    }
    return getThreat(bot, TRIGGER_RADIUS) !== null;
  },

  createState: (bot: Bot) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    const pathfinder = (bot as any)?.pathfinder;
    if (!pathfinder || typeof pathfinder.setGoal !== 'function') {
      logger.debug('HostileFlee: no pathfinder available');
      return null;
    }

    const safeChat: ((msg: string) => void) | null =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      typeof (bot as any)?.safeChat === 'function'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        ? (bot as any).safeChat.bind(bot)
        : typeof bot?.chat === 'function'
          ? bot.chat.bind(bot)
          : null;

    const ctx: FleeContext = {
      threatLabel: 'hostile mob',
      lastKnownThreatPos: null,
      lastThreatSeenTime: 0,
      safeChat,
      startAnnounced: false
    };

    const capture = new BehaviorCaptureThreat(bot, ctx);
    const fleeVisible = new BehaviorFleeVisible(bot, ctx);
    const fleeFromMemory = new BehaviorFleeFromMemory(bot, ctx);
    const exit = new BehaviorIdle();

    const transitions = [
      new StateTransition({
        parent: capture,
        child: fleeVisible,
        name: 'hostile-flee: capture -> fleeVisible',
        shouldTransition: () => capture.isFinished() && capture.foundThreat()
      }),
      new StateTransition({
        parent: capture,
        child: exit,
        name: 'hostile-flee: capture -> exit (no threat)',
        shouldTransition: () => capture.isFinished() && !capture.foundThreat()
      }),
      new StateTransition({
        parent: fleeVisible,
        child: fleeFromMemory,
        name: 'hostile-flee: fleeVisible -> fleeFromMemory',
        shouldTransition: () => fleeVisible.lostThreat()
      }),
      new StateTransition({
        parent: fleeVisible,
        child: exit,
        name: 'hostile-flee: fleeVisible -> exit',
        shouldTransition: () => fleeVisible.isFinished()
      }),
      new StateTransition({
        parent: fleeFromMemory,
        child: fleeVisible,
        name: 'hostile-flee: fleeFromMemory -> fleeVisible',
        shouldTransition: () => fleeFromMemory.threatReappeared()
      }),
      new StateTransition({
        parent: fleeFromMemory,
        child: exit,
        name: 'hostile-flee: fleeFromMemory -> exit',
        shouldTransition: () => fleeFromMemory.isFinished()
      })
    ];

    const stateMachine = new NestedStateMachine(transitions, capture, exit);
    // The reactive executor and the existing spec both key on this
    // name; override the derived one so it remains stable.
    stateMachine.stateName = 'HostileFlee';

    return {
      stateMachine,
      isFinished: () => stateMachine.isFinished(),
      onStop: (reason: ReactiveBehaviorStopReason) => {
        forceStopAllMovement(bot, 'hostile flee exit');
        if (!ctx.startAnnounced || !ctx.safeChat) {
          return;
        }
        const verb =
          reason === 'completed'
            ? 'done fleeing'
            : reason === 'preempted'
              ? 'pausing flee'
              : 'stopped fleeing';
        try {
          ctx.safeChat(`${verb} ${ctx.threatLabel}`);
        } catch (_) {
          // chat failures must never destabilize the executor
        }
      }
    };
  }
};
