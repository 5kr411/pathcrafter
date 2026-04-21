import logger from '../../utils/logger';
import { Bot } from './config';
import { createTrackedBotStateMachine } from './state_machine_utils';

export class StateMachineRunner {
  private readonly listener: (this: Bot) => void;
  private started = false;
  private entered = false;

  constructor(
    private readonly bot: Bot,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    private readonly rootStateMachine: any
  ) {
    const tracked = createTrackedBotStateMachine(this.bot, this.rootStateMachine);
    this.listener = function(this: Bot) {
      tracked.listener.call(this);
    }.bind(this.bot);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.attach();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.detach();
    if (this.entered && this.rootStateMachine && typeof this.rootStateMachine.onStateExited === 'function') {
      try {
        this.rootStateMachine.onStateExited();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.debug(`StateMachineRunner: error during root exit - ${err?.message || err}`);
      }
    }
    this.entered = false;
  }

  private attach(): void {
    if (!this.entered && this.rootStateMachine && typeof this.rootStateMachine.onStateEntered === 'function') {
      try {
        this.rootStateMachine.onStateEntered();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.debug(`StateMachineRunner: error during root enter - ${err?.message || err}`);
      }
      this.entered = true;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      if (typeof (this.bot as any).on === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        (this.bot as any).on('physicTick', this.listener);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        (this.bot as any).on('physicsTick', this.listener);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`StateMachineRunner: error attaching listener - ${err?.message || err}`);
    }
  }

  private detach(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      if (typeof (this.bot as any).off === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        (this.bot as any).off('physicTick', this.listener);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        (this.bot as any).off('physicsTick', this.listener);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      } else if (typeof (this.bot as any).removeListener === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        (this.bot as any).removeListener('physicTick', this.listener);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        (this.bot as any).removeListener('physicsTick', this.listener);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`StateMachineRunner: error detaching listener - ${err?.message || err}`);
    }
  }
}
