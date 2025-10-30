const minecraftData = require('minecraft-data');

export interface ToolInfo {
  item: any;
  name: string;
  remainingUses: number;
  maxDurability: number;
}

export interface BlockToolRequirement {
  blockName: string;
  requiresToolType: string | null;
  minimumToolTier: string | null;
  harvestToolIds: number[];
}

export function getToolRemainingUses(bot: any, item: any): number {
  if (!item || typeof item.type !== 'number') {
    return 0;
  }

  try {
    const itemData = bot.registry?.items?.[item.type];
    if (!itemData) {
      return 0;
    }

    const maxDurability = itemData.maxDurability;
    if (!maxDurability || !Number.isFinite(maxDurability)) {
      return 0;
    }

    const durabilityUsed = item.durabilityUsed || 0;
    const remaining = maxDurability - durabilityUsed;
    
    return Math.max(0, remaining);
  } catch (_) {
    return 0;
  }
}

export function getToolInfo(bot: any, item: any): ToolInfo | null {
  if (!item) return null;

  try {
    const remainingUses = getToolRemainingUses(bot, item);
    const itemData = bot.registry?.items?.[item.type];
    const maxDurability = itemData?.maxDurability || 0;
    
    return {
      item,
      name: item.name || 'unknown',
      remainingUses,
      maxDurability
    };
  } catch (_) {
    return null;
  }
}

export function hasToolForBlock(bot: any, blockName: string): boolean {
  try {
    const mcData = minecraftData(bot.version);
    const blockInfo = mcData.blocksByName[blockName];
    
    if (!blockInfo || !blockInfo.harvestTools || Object.keys(blockInfo.harvestTools).length === 0) {
      return true;
    }

    const requiredToolIds = new Set(
      Object.keys(blockInfo.harvestTools).map((id) => Number(id))
    );

    const items = bot.inventory?.items?.() || [];
    for (const item of items) {
      if (item && requiredToolIds.has(item.type)) {
        return true;
      }
    }

    return false;
  } catch (_) {
    return false;
  }
}

export function getMinimumToolForBlock(bot: any, blockName: string): string | null {
  try {
    const mcData = minecraftData(bot.version);
    const blockInfo = mcData.blocksByName[blockName];
    
    if (!blockInfo || !blockInfo.harvestTools) {
      return null;
    }

    const toolIds = Object.keys(blockInfo.harvestTools);
    if (toolIds.length === 0) {
      return null;
    }

    const toolNames: string[] = [];
    for (const toolIdStr of toolIds) {
      const toolId = Number(toolIdStr);
      const toolItem = mcData.items[toolId];
      if (toolItem && toolItem.name) {
        toolNames.push(toolItem.name);
      }
    }

    if (toolNames.length === 0) {
      return null;
    }

    const toolTiers = ['wooden', 'stone', 'iron', 'diamond', 'netherite', 'golden'];
    let lowestTier = Infinity;
    let lowestTierTool: string | null = null;

    for (const toolName of toolNames) {
      for (let i = 0; i < toolTiers.length; i++) {
        if (toolName.startsWith(toolTiers[i])) {
          if (i < lowestTier) {
            lowestTier = i;
            lowestTierTool = toolName;
          }
          break;
        }
      }
    }

    return lowestTierTool || toolNames[0];
  } catch (_) {
    return null;
  }
}

export function findToolInInventory(bot: any, toolName: string): any | null {
  try {
    const items = bot.inventory?.items?.() || [];
    for (const item of items) {
      if (item && item.name === toolName) {
        return item;
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

export function getBlockToolRequirement(bot: any, blockName: string): BlockToolRequirement {
  try {
    const mcData = minecraftData(bot.version);
    const blockInfo = mcData.blocksByName[blockName];
    
    const result: BlockToolRequirement = {
      blockName,
      requiresToolType: null,
      minimumToolTier: null,
      harvestToolIds: []
    };

    if (!blockInfo || !blockInfo.harvestTools) {
      return result;
    }

    const toolIds = Object.keys(blockInfo.harvestTools).map(id => Number(id));
    result.harvestToolIds = toolIds;

    if (toolIds.length > 0) {
      const firstToolId = toolIds[0];
      const toolItem = mcData.items[firstToolId];
      
      if (toolItem && toolItem.name) {
        const toolName = toolItem.name;
        const parts = toolName.split('_');
        
        if (parts.length >= 2) {
          result.requiresToolType = parts[parts.length - 1];
          result.minimumToolTier = parts.slice(0, -1).join('_');
        }
      }
    }

    return result;
  } catch (_) {
    return {
      blockName,
      requiresToolType: null,
      minimumToolTier: null,
      harvestToolIds: []
    };
  }
}

export function findBestToolForBlock(bot: any, blockName: string): any | null {
  try {
    const mcData = minecraftData(bot.version);
    const blockInfo = mcData.blocksByName[blockName];
    
    if (!blockInfo || !blockInfo.harvestTools) {
      return null;
    }

    const requiredToolIds = new Set(
      Object.keys(blockInfo.harvestTools).map((id) => Number(id))
    );

    if (requiredToolIds.size === 0) {
      return null;
    }

    const items = bot.inventory?.items?.() || [];
    let bestTool: any = null;
    let bestDurability = -1;

    for (const item of items) {
      if (!item || typeof item.type !== 'number') continue;
      if (!requiredToolIds.has(item.type)) continue;

      const itemData = bot.registry?.items?.[item.type];
      const maxDurability = itemData?.maxDurability || 0;
      
      if (maxDurability > bestDurability) {
        bestTool = item;
        bestDurability = maxDurability;
      }
    }

    return bestTool;
  } catch (_) {
    return null;
  }
}

export function getToolTier(toolName: string): number {
  const toolTiers = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'];
  
  for (let i = 0; i < toolTiers.length; i++) {
    if (toolName.startsWith(toolTiers[i])) {
      return i;
    }
  }
  
  return -1;
}

export function hasEqualOrBetterToolTier(bot: any, requiredToolName: string): boolean {
  try {
    const requiredTier = getToolTier(requiredToolName);
    if (requiredTier === -1) return false;

    const requiredParts = requiredToolName.split('_');
    const requiredToolType = requiredParts[requiredParts.length - 1];

    const items = bot.inventory?.items?.() || [];
    for (const item of items) {
      if (!item || !item.name) continue;
      
      const itemParts = item.name.split('_');
      const itemToolType = itemParts[itemParts.length - 1];
      
      if (itemToolType === requiredToolType) {
        const itemTier = getToolTier(item.name);
        if (itemTier >= requiredTier) {
          return true;
        }
      }
    }

    return false;
  } catch (_) {
    return false;
  }
}

