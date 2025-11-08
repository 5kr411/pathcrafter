import logger from './logger';

const MAX_REASONABLE_KNOCKBACK = 1000;

function isValidNumber(value: any): boolean {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  if (Number.isNaN(value)) return false;
  
  // Check for absurdly large values that indicate corruption
  // Normal knockback values are < 10, but allow generous headroom
  if (Math.abs(value) > MAX_REASONABLE_KNOCKBACK) {
    return false;
  }
  
  return true;
}

function isExplosionPacketValid(packet: any): boolean {
  if (!packet) {
    return false;
  }

  if (packet.playerKnockback) {
    if (!isValidNumber(packet.playerKnockback.x) ||
        !isValidNumber(packet.playerKnockback.y) ||
        !isValidNumber(packet.playerKnockback.z)) {
      return false;
    }
  }

  if (packet.playerMotionX !== undefined && !isValidNumber(packet.playerMotionX)) {
    return false;
  }
  if (packet.playerMotionY !== undefined && !isValidNumber(packet.playerMotionY)) {
    return false;
  }
  if (packet.playerMotionZ !== undefined && !isValidNumber(packet.playerMotionZ)) {
    return false;
  }

  return true;
}

export function installExplosionSanitizer(bot: any): void {
  if (!bot || !bot._client) {
    logger.warn('ExplosionSanitizer: invalid bot or client, cannot install');
    return;
  }

  const client = bot._client;
  const originalEmit = client.emit;
  
  client.emit = function(event: string, ...args: any[]) {
    if (event === 'explosion') {
      const packet = args[0];
      if (!isExplosionPacketValid(packet)) {
        logger.warn('ExplosionSanitizer: blocked malformed explosion packet with invalid numeric values');
        return false;
      }
    }
    
    try {
      return originalEmit.apply(this, [event, ...args] as any);
    } catch (err: any) {
      if (event === 'explosion') {
        logger.warn(`ExplosionSanitizer: caught and suppressed error during explosion event: ${err?.message || err}`);
        return false;
      }
      throw err;
    }
  };

  logger.info('ExplosionSanitizer: installed explosion packet filter - will block malformed packets');
}

