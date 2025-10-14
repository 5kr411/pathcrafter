import { EventEmitter } from 'events';

// mineflayer-statemachine is CommonJS; require to avoid ts-jest interop issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BotStateMachine } = require('mineflayer-statemachine');

type LoggerInstance = import('../../utils/logger').Logger;

export interface RunOptions {
  maxMs?: number;
  stepMs?: number;
  directNested?: boolean;
}

/**
 * Drive a BotStateMachine deterministically by emitting physicTick on the bot.
 * Uses Jest fake timers. Caller is responsible for jest.useFakeTimers().
 */
export async function runWithFakeClock(
  bot: EventEmitter,
  machine: any,
  options: RunOptions = {}
): Promise<void> {
  const maxMs = options.maxMs ?? 10000;
  const stepMs = options.stepMs ?? 50;

  // Ensure mineflayer-statemachine globalSettings exists to avoid circular import undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('mineflayer-statemachine');
    if (!pkg.globalSettings) pkg.globalSettings = { debugMode: false };
    else pkg.globalSettings.debugMode = false;
    // Also ensure the internal index module used by statemachine.js has the flag
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const idx = require('mineflayer-statemachine/lib/index.js');
    if (!idx.globalSettings) idx.globalSettings = { debugMode: false };
    else idx.globalSettings.debugMode = false;
  } catch {}

  if (options.directNested && machine && typeof machine.update === 'function') {
    // Manually activate without calling library onStateEntered to avoid debugMode reference
    machine.active = true;
    if (machine.enter) {
      machine.activeState = machine.enter;
      if (machine.activeState) {
        machine.activeState.active = true;
        if (typeof machine.activeState.onStateEntered === 'function') {
          try { machine.activeState.onStateEntered(); } catch {}
        }
      }
    }
  } else {
    // Bind the machine to the bot
    // eslint-disable-next-line no-new
    new BotStateMachine(bot, machine);
  }

  let now = Date.now();
  const end = now + maxMs;

  while (now < end) {
    // Advance timers and system time so behaviors relying on Date.now() progress
    jest.advanceTimersByTime(stepMs);
    now += stepMs;
    jest.setSystemTime(now);

    // Emit a physic tick to trigger BotStateMachine.update() (ignored in directNested mode)
    (bot as any).emit && (bot as any).emit('physicTick');

    // If driving a NestedStateMachine directly, call update explicitly
    if (options.directNested && typeof (machine as any).update === 'function') {
      (machine as any).update();
    }

    // Yield to let any pending microtasks settle
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

/**
 * Spy on logger methods (info/warn/error/debug) during a test and restore after.
 */
export function withLoggerSpy<T>(fn: (logger: LoggerInstance) => Promise<T> | T): Promise<T> | T {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const logger: LoggerInstance = (require('../../utils/logger').default || require('../../utils/logger')) as LoggerInstance;
  const orig = {
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    debug: logger.debug.bind(logger)
  } as const;
  const info = jest.spyOn(logger as any, 'info').mockImplementation(() => {});
  const warn = jest.spyOn(logger as any, 'warn').mockImplementation(() => {});
  const error = jest.spyOn(logger as any, 'error').mockImplementation(() => {});
  const debug = jest.spyOn(logger as any, 'debug').mockImplementation(() => {});

  const restore = () => {
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    debug.mockRestore();
    (logger as any).info = orig.info;
    (logger as any).warn = orig.warn;
    (logger as any).error = orig.error;
    (logger as any).debug = orig.debug;
  };

  const res = Promise.resolve()
    .then(() => fn(logger))
    .finally(restore) as Promise<T>;
  return res;
}


