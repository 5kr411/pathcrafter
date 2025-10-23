import logger from './logger';

interface BotLike {
  pathfinder?: any;
  ashfinder?: any;
  clearControlStates?: () => void;
  [key: string]: any;
}

export function forceStopAllMovement(bot: BotLike, reason?: string): void {
  try {
    if (bot.pathfinder) {
      try {
        if (typeof bot.pathfinder.setGoal === 'function') {
          bot.pathfinder.setGoal(null);
        }
      } catch (err: any) {
        logger.debug(`forceStopAllMovement: error clearing pathfinder goal: ${err.message}`);
      }
      try {
        if (typeof bot.pathfinder.isMoving === 'function' && bot.pathfinder.isMoving()) {
          bot.pathfinder.stop();
        }
      } catch (err: any) {
        logger.debug(`forceStopAllMovement: error stopping pathfinder: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.debug(`forceStopAllMovement: pathfinder stop error: ${err.message}`);
  }

  try {
    if (bot.ashfinder) {
      try {
        bot.ashfinder.stop();
      } catch (err: any) {
        logger.debug(`forceStopAllMovement: error stopping ashfinder: ${err.message}`);
      }
      try {
        if (typeof bot.ashfinder.removeAllListeners === 'function') {
          bot.ashfinder.removeAllListeners();
        }
      } catch (err: any) {
        logger.debug(`forceStopAllMovement: error removing ashfinder listeners: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.debug(`forceStopAllMovement: ashfinder stop error: ${err.message}`);
  }

  try {
    if (typeof bot.clearControlStates === 'function') {
      bot.clearControlStates();
    }
  } catch (err: any) {
    logger.debug(`forceStopAllMovement: error clearing control states: ${err.message}`);
  }

  if (reason) {
    logger.debug(`forceStopAllMovement: completed (${reason})`);
  }
}


