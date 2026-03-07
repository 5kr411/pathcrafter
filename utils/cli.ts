import { Target } from '../bots/collector/config';
import { parseTargetsFromMessage } from '../bots/collector/chat_handler';

export function parseCliTargets(): Target[] | null {
  const idx = process.argv.indexOf('--targets');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;

  const raw = process.argv[idx + 1];
  if (!raw || !raw.trim()) return null;

  // Prepend "collect " so parseTargetsFromMessage's regex strip works
  const targets = parseTargetsFromMessage('collect ' + raw);
  return targets.length > 0 ? targets : null;
}
