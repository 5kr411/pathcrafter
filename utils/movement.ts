import logger from './logger';

interface BotLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  pathfinder?: any;
  clearControlStates?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  [key: string]: any;
}

export function forceStopAllMovement(bot: BotLike, reason?: string): void {
  try {
    if (bot.pathfinder) {
      try {
        if (typeof bot.pathfinder.setGoal === 'function') {
          bot.pathfinder.setGoal(null);
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.debug(`forceStopAllMovement: error clearing pathfinder goal: ${err.message}`);
      }
      try {
        if (typeof bot.pathfinder.isMoving === 'function' && bot.pathfinder.isMoving()) {
          bot.pathfinder.stop();
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.debug(`forceStopAllMovement: error stopping pathfinder: ${err.message}`);
      }
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
  } catch (err: any) {
    logger.debug(`forceStopAllMovement: pathfinder stop error: ${err.message}`);
  }

  try {
    if (typeof bot.clearControlStates === 'function') {
      bot.clearControlStates();
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
  } catch (err: any) {
    logger.debug(`forceStopAllMovement: error clearing control states: ${err.message}`);
  }

  if (reason) {
    logger.debug(`forceStopAllMovement: completed (${reason})`);
  }
}


