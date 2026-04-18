// Pure helper for dev_observer's chat_in polling logic.
//
// Extracted so truncation handling can be unit-tested without spawning a bot.
import * as fs from 'fs';

export interface PollResult {
  /** New offset to track for next poll. */
  lastSize: number;
  /** Number of lines delivered to onLine during this poll. */
  linesDelivered: number;
}

/**
 * Read any bytes appended to `chat_in` since `lastSize` and invoke `onLine`
 * for each non-empty trimmed line.
 *
 * Resets `lastSize` to 0 when the file was truncated (current size < lastSize).
 * Returns early if there is nothing new to read.
 */
export function pollChatIn(
  chatInPath: string,
  lastSize: number,
  onLine: (line: string) => void
): PollResult {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(chatInPath);
  } catch {
    return { lastSize, linesDelivered: 0 };
  }

  // Truncation detection: if the file shrank (e.g. `> chat_in` or log rotation)
  // our tracked offset is past the end, so reset to 0 and re-read from the start.
  if (stat.size < lastSize) {
    lastSize = 0;
  }

  if (stat.size <= lastSize) {
    return { lastSize, linesDelivered: 0 };
  }

  const fd = fs.openSync(chatInPath, 'r');
  try {
    const buf = Buffer.alloc(stat.size - lastSize);
    fs.readSync(fd, buf, 0, buf.length, lastSize);
    const newLastSize = stat.size;
    let delivered = 0;
    for (const line of buf.toString('utf8').split('\n')) {
      const t = line.trim();
      if (t) { onLine(t); delivered++; }
    }
    return { lastSize: newLastSize, linesDelivered: delivered };
  } finally {
    fs.closeSync(fd);
  }
}
