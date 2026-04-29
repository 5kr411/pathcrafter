export interface NudgeContextDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bot is mineflayer-typed
  bot: any;
  idleMs: number;
  nudgeNumber: number;
}

const INVENTORY_LIMIT = 30;

export function buildNudgeContext(deps: NudgeContextDeps): string {
  const { bot, idleMs, nudgeNumber } = deps;
  const idleSec = Math.floor(idleMs / 1000);

  const pos = bot?.entity?.position;
  const posStr = pos
    ? `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`
    : '(?)';
  const dimension = bot?.game?.dimension ?? 'overworld';

  const health = bot?.health ?? '?';
  const food = bot?.food ?? '?';
  const saturation = bot?.foodSaturation ?? 0;

  const tod = bot?.time?.timeOfDay ?? 0;
  const phase = tod >= 13000 && tod < 23000 ? 'night' : 'day';

  const items: { name: string; count: number }[] = bot?.inventory?.items?.() ?? [];
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.name, (counts.get(it.name) ?? 0) + it.count);
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const topN = ranked.slice(0, INVENTORY_LIMIT).map(([name, count]) => `${name}:${count}`);
  const invStr = topN.length === 0 ? '(empty)' : topN.join(', ');

  return [
    `[idle-nudge #${nudgeNumber} | idle for ${idleSec}s]`,
    ``,
    `Current state:`,
    `  position: ${posStr} in ${dimension}`,
    `  health: ${health}/20  food: ${food}/20  saturation: ${saturation}`,
    `  time: ${phase} (ticks=${tod})`,
    `  inventory (top ${INVENTORY_LIMIT} by count): ${invStr}`,
    ``,
    `You have no active behavior and the agent loop has been idle for ${idleSec}s.`,
    `Pick up where you left off by calling a tool, or call`,
    `finish_session({reason: "..."}) if you are genuinely done.`
  ].join('\n');
}
