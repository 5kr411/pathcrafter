/**
 * Rate-limited chat sender.
 *
 * Vanilla Minecraft servers kick a player for chat spam (roughly 200 "score"
 * points accumulating faster than 20/s — see the MC wiki). Reactive behaviors
 * and the agent both emit narration chat, and bursts can trip the kick: e.g.
 * opportunistic_food_hunt killing five pigs in 700ms broadcast 10 messages
 * and got the bot kicked with socketClosed.
 *
 * This helper wraps bot.chat in a FIFO queue with a minimum interval between
 * sends. Messages are preserved in order and dispatched at a steady pace; the
 * caller's `safeChat(msg)` returns immediately.
 *
 * Use from each bot's entry point to build the safeChat closure:
 *
 *   const safeChat = createRateLimitedChat(bot);
 *   (bot as any).safeChat = safeChat;
 */

import logger from './logger';

export interface RateLimitedChatOptions {
  /** Minimum milliseconds between chat sends. Defaults to 300ms (~3 msg/sec). */
  minIntervalMs?: number;
  /** Maximum queued messages; oldest are dropped beyond this cap. Defaults to 50. */
  maxQueueSize?: number;
}

export function createRateLimitedChat(
  bot: any,
  options: RateLimitedChatOptions = {}
): (msg: string) => void {
  const minIntervalMs = options.minIntervalMs ?? 300;
  const maxQueueSize = options.maxQueueSize ?? 50;

  const queue: string[] = [];
  let lastSentAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function send(msg: string): void {
    try {
      if (bot && bot._client && !bot._client.ended) {
        bot.chat(msg);
      }
    } catch (_) {
      // Swallow — matches existing safeChat contract.
    }
  }

  function flush(): void {
    timer = null;
    if (queue.length === 0) return;
    const now = Date.now();
    const wait = Math.max(0, minIntervalMs - (now - lastSentAt));
    if (wait > 0) {
      timer = setTimeout(flush, wait);
      return;
    }
    const msg = queue.shift()!;
    lastSentAt = Date.now();
    send(msg);
    if (queue.length > 0) {
      timer = setTimeout(flush, minIntervalMs);
    }
  }

  return function safeChat(msg: string): void {
    if (typeof msg !== 'string' || msg.length === 0) return;
    queue.push(msg);
    if (queue.length > maxQueueSize) {
      const dropped = queue.splice(0, queue.length - maxQueueSize);
      logger.warn(`rateLimitedChat: queue overflow, dropped ${dropped.length} oldest messages`);
    }
    if (timer === null) {
      flush();
    }
  };
}
