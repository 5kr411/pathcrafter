const { BotStateMachine } = require('mineflayer-statemachine');
import logger from '../../utils/logger';
import { Bot } from './reactive_behaviors/types';
import { ReactiveBehaviorRegistry } from './reactive_behavior_registry';

export interface ReactiveBehaviorExecutor {
  finish(success: boolean): void;
}

export class ReactiveBehaviorExecutorClass {
  private active = false;
  private botStateMachine: any = null;
  private resolve: ((success: boolean) => void) | null = null;
  private currentBehavior: any = null;
  public readonly registry: ReactiveBehaviorRegistry;

  constructor(
    private bot: Bot,
    registry: ReactiveBehaviorRegistry
  ) {
    this.registry = registry;
  }

  isActive(): boolean {
    return this.active;
  }

  async executeBehavior(behavior: any): Promise<boolean> {
    if (this.active) {
      logger.warn('ReactiveBehaviorExecutor: behavior already in progress, rejecting concurrent request');
      return false;
    }

    if (this.botStateMachine !== null) {
      logger.warn('ReactiveBehaviorExecutor: bot state machine already active, rejecting request');
      return false;
    }

    logger.info(`ReactiveBehaviorExecutor: starting behavior ${behavior.name}`);

    this.active = true;
    this.currentBehavior = behavior;

    return await new Promise<boolean>((resolve) => {
      this.resolve = resolve;
      this.startExecution(behavior);
    });
  }

  private async startExecution(behavior: any): Promise<void> {
    try {
      const executor: ReactiveBehaviorExecutor = {
        finish: (success: boolean) => {
          this.finish(success);
        }
      };

      const stateMachine = await behavior.execute(this.bot, executor);
      
      if (!stateMachine) {
        logger.info(`ReactiveBehaviorExecutor: behavior ${behavior.name} returned no state machine`);
        this.finish(false);
        return;
      }

      this.botStateMachine = new BotStateMachine(this.bot, stateMachine);
    } catch (err: any) {
      logger.info(`ReactiveBehaviorExecutor: failed to start execution - ${err?.message || err}`);
      this.finish(false);
    }
  }

  finish(success: boolean): void {
    if (this.botStateMachine && typeof this.botStateMachine.stop === 'function') {
      try {
        this.botStateMachine.stop();
      } catch (_) {}
    }

    this.botStateMachine = null;
    
    if (this.currentBehavior && typeof this.currentBehavior.onDeactivate === 'function') {
      try {
        this.currentBehavior.onDeactivate();
      } catch (err: any) {
        logger.debug(`ReactiveBehaviorExecutor: error in onDeactivate: ${err?.message || err}`);
      }
    }
    
    this.currentBehavior = null;
    this.active = false;

    const resolve = this.resolve;
    this.resolve = null;

    if (resolve) {
      try {
        resolve(success);
      } catch (err: any) {
        logger.debug(`ReactiveBehaviorExecutor: error resolving promise: ${err?.message || err}`);
      }
    }
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    logger.debug('ReactiveBehaviorExecutor: stopping');
    this.finish(false);
  }
}

