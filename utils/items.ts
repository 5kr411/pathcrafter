/**
 * Item and tool utilities
 */

/**
 * Tool tier ranking for choosing minimal tools
 */
const TIER_RANK: Record<string, number> = {
  wooden: 0,
  golden: 0.5,
  stone: 1,
  iron: 2,
  diamond: 3,
  netherite: 4
};

/**
 * Ranks a tool name by its tier
 */
function rank(name: string): number {
  const first = String(name).split('_')[0];
  const base = TIER_RANK[first];
  if (base === undefined) return 10;
  return base;
}

/**
 * Chooses the lowest-tier tool from a list of tool names
 * 
 * @param toolNames - Array of tool names to choose from
 * @returns The lowest-tier tool name, or undefined if empty
 * 
 * @example
 * chooseMinimalToolName(['diamond_pickaxe', 'wooden_pickaxe', 'stone_pickaxe'])
 * // returns 'wooden_pickaxe'
 */
export function chooseMinimalToolName(toolNames: string[]): string | undefined {
  if (!toolNames || toolNames.length === 0) return undefined;

  let best = toolNames[0];
  let bestRank = rank(best);

  for (let i = 1; i < toolNames.length; i++) {
    const r = rank(toolNames[i]);
    if (r < bestRank) {
      best = toolNames[i];
      bestRank = r;
    }
  }

  return best;
}

/**
 * Extracts the suffix token from an item name
 * 
 * @param name - Item name (e.g., 'wooden_pickaxe')
 * @returns The suffix token (e.g., 'pickaxe')
 * 
 * @example
 * getSuffixTokenFromName('wooden_pickaxe') // returns 'pickaxe'
 * getSuffixTokenFromName('coal') // returns 'coal'
 */
export function getSuffixTokenFromName(name: string): string {
  if (!name) return name;
  const idx = name.lastIndexOf('_');
  if (idx === -1) return name;
  return name.slice(idx + 1);
}

