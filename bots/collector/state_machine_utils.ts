const { BotStateMachine } = require('mineflayer-statemachine');
import logger from '../../utils/logger';
import { Bot } from './config';

function logDebug(msg: string, ...args: any[]): void {
  logger.debug(msg, ...args);
}

export function createTrackedBotStateMachine(
  bot: Bot,
  stateMachine: any
): { botStateMachine: any; listener: (this: Bot) => void } {
  const listener = function(this: Bot) {
    try {
      stateMachine.update();
    } catch (err: any) {
      logDebug(`BotStateMachine update error: ${err?.message || err}`);
    }
  };

  const botStateMachine = Object.create(BotStateMachine.prototype);
  botStateMachine.bot = bot;
  botStateMachine.rootStateMachine = stateMachine;
  botStateMachine.states = [];
  botStateMachine.transitions = [];
  botStateMachine.nestedStateMachines = [];

  if (typeof BotStateMachine.prototype.findStatesRecursive === 'function') {
    BotStateMachine.prototype.findStatesRecursive.call(botStateMachine, stateMachine);
  }
  if (typeof BotStateMachine.prototype.findTransitionsRecursive === 'function') {
    BotStateMachine.prototype.findTransitionsRecursive.call(botStateMachine, stateMachine);
  }
  if (typeof BotStateMachine.prototype.findNestedStateMachines === 'function') {
    BotStateMachine.prototype.findNestedStateMachines.call(botStateMachine, stateMachine);
  }

  return { botStateMachine, listener };
}


