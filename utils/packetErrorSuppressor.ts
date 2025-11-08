import logger from './logger';

const SUPPRESSED_ERROR_PATTERNS = [
  'PartialReadError',
  'Read error for undefined',
  'Unexpected buffer end while reading VarInt',
  'Chunk size is'
];

export function installPacketErrorSuppressor(bot: any): void {
  if (!bot || !bot._client) {
    logger.warn('PacketErrorSuppressor: invalid bot or client, cannot install');
    return;
  }
  
  const originalConsoleError = console.error;
  console.error = function(...args: any[]) {
    const firstArg = args[0];
    if (typeof firstArg === 'string') {
      for (const pattern of SUPPRESSED_ERROR_PATTERNS) {
        if (firstArg.includes(pattern)) {
          logger.debug(`PacketErrorSuppressor: suppressed packet read error output`);
          return;
        }
      }
    }
    
    if (firstArg && typeof firstArg === 'object' && firstArg.constructor) {
      const errorName = firstArg.constructor.name;
      if (errorName === 'PartialReadError') {
        logger.debug('PacketErrorSuppressor: suppressed PartialReadError console output');
        return;
      }
    }
    
    return originalConsoleError.apply(console, args);
  };

  logger.info('PacketErrorSuppressor: installed console error suppressor for malformed packets');
}

