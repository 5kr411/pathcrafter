/**
 * Item and tool utilities
 */

/**
 * Tool tier ranking for choosing minimal tools.
 * Populated by initTierRanks() from minecraft-data; falls back to hardcoded defaults.
 */
let tierRanks: Record<string, number> = {
  wooden: 0,
  golden: 0.5,
  stone: 1,
  iron: 2,
  diamond: 3,
  netherite: 4
};

/**
 * Derives tier ranks from minecraft-data by counting harvestTools coverage.
 * Higher-tier pickaxes can mine more blocks → higher coverage count → higher rank.
 * Called from resolveMcData() on first resolve.
 */
export function initTierRanks(mcData: any): void {
  const pickaxes = Object.values(mcData.items)
    .filter((item: any) => item.name?.endsWith('_pickaxe'));
  if (pickaxes.length === 0) return;

  const blocks = Object.values(mcData.blocks);
  const coverage = new Map<string, number>();

  for (const pickaxe of pickaxes) {
    let count = 0;
    for (const block of blocks) {
      if ((block as any).harvestTools && (block as any).harvestTools[(pickaxe as any).id]) count++;
    }
    coverage.set((pickaxe as any).name, count);
  }

  // Build a map of pickaxe name -> item ID for tiebreaking
  const pickaxeIds = new Map<string, number>();
  for (const pickaxe of pickaxes) {
    pickaxeIds.set((pickaxe as any).name, (pickaxe as any).id);
  }

  // Sort by coverage count, then by item ID as tiebreaker (higher ID = higher tier)
  const sorted = [...coverage.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1];
    return (pickaxeIds.get(a[0]) || 0) - (pickaxeIds.get(b[0]) || 0);
  });
  const newRanks: Record<string, number> = {};
  let currentRank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const [name] = sorted[i];
    currentRank = i + 1;
    newRanks[name.replace('_pickaxe', '')] = currentRank;
  }
  tierRanks = newRanks;
}

/**
 * Ranks a tool name by its tier
 * 
 * @param name - Tool name (e.g., 'wooden_pickaxe', 'diamond_axe')
 * @returns Numeric rank where higher = better tier (0=wooden, 4=netherite)
 * 
 * @example
 * rank('wooden_pickaxe') // returns 0
 * rank('diamond_pickaxe') // returns 3
 */
export function rank(name: string): number {
  const first = String(name).split('_')[0];
  const base = tierRanks[first];
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

/**
 * Checks if inventory contains a tool that is equal to or better than the required tool
 * 
 * Compares tools by type (suffix) and tier. For example, if wooden_pickaxe is required
 * but inventory has diamond_pickaxe, this returns true since diamond is a better tier.
 * 
 * @param inventory - Map of item names to quantities
 * @param requiredTool - The minimum tool required (e.g., 'wooden_pickaxe')
 * @returns true if inventory has an equal or better tool of the same type
 * 
 * @example
 * const inv = new Map([['diamond_pickaxe', 1]]);
 * hasEqualOrBetterTool(inv, 'wooden_pickaxe') // returns true
 * hasEqualOrBetterTool(inv, 'iron_axe') // returns false (different tool type)
 */
export function hasEqualOrBetterTool(
  inventory: Map<string, number> | undefined,
  requiredTool: string
): boolean {
  if (!inventory || inventory.size === 0) return false;
  
  const requiredSuffix = getSuffixTokenFromName(requiredTool);
  const requiredRank = rank(requiredTool);
  
  // Check each item in inventory
  for (const [itemName, count] of inventory.entries()) {
    if (!count || count <= 0) continue;
    
    // Same tool type?
    const itemSuffix = getSuffixTokenFromName(itemName);
    if (itemSuffix !== requiredSuffix) continue;
    
    // Equal or better tier?
    const itemRank = rank(itemName);
    if (itemRank >= requiredRank) {
      return true;
    }
  }
  
  return false;
}

