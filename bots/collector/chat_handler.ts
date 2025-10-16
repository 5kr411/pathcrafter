import { Target } from './config';

export function parseTargetsFromMessage(message: string): Target[] {
  const afterCmd = message.replace(/^\s*(collect|go)\s*/i, '');
  return afterCmd
    .split(',')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const parts = seg.split(/\s+/).filter(Boolean);
      const item = parts[0];
      const count = Number.parseInt(parts[1]);
      return item && Number.isFinite(count) && count > 0 ? { item, count } : null;
    })
    .filter((t): t is Target => t !== null);
}

