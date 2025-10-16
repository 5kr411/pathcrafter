const minecraftData = require('minecraft-data');

interface Bot {
  version: string;
  pathfinder: any;
  entity?: any;
  [key: string]: any;
}

export interface PathfinderPrecisionConfig {
  scafoldingBlocks?: number[];
  maxDropDown?: number;
  infiniteLiquidDropdownDistance?: boolean;
  searchRadius?: number;
  allow1by1towers?: boolean;
  allowFreeMotion?: boolean;
  allowParkour?: boolean;
  allowSprinting?: boolean;
  canDig?: boolean;
  canOpenDoors?: boolean;
  dontCreateFlow?: boolean;
  dontMineUnderFallingBlock?: boolean;
}

export const PRECISE_MOVEMENTS_CONFIG: PathfinderPrecisionConfig = {
  searchRadius: 80,
  allow1by1towers: true,
  allowFreeMotion: false,
  allowParkour: false,
  allowSprinting: true,
  canDig: true,
  canOpenDoors: true,
  dontCreateFlow: true,
  dontMineUnderFallingBlock: true,
  maxDropDown: 4,
  infiniteLiquidDropdownDistance: false
};

export function configurePrecisePathfinder(
  bot: Bot,
  customConfig?: Partial<PathfinderPrecisionConfig>
): void {
  try {
    const { Movements } = require('mineflayer-pathfinder');
    const mcData = minecraftData(bot.version);
    
    const config = { ...PRECISE_MOVEMENTS_CONFIG, ...customConfig };
    
    const movements = new Movements(bot, mcData);
    
    if (config.scafoldingBlocks !== undefined) {
      movements.scafoldingBlocks = config.scafoldingBlocks;
    } else {
      movements.scafoldingBlocks = [
        mcData.blocksByName.dirt?.id,
        mcData.blocksByName.cobblestone?.id,
        mcData.blocksByName.stone?.id,
        mcData.blocksByName.oak_planks?.id,
        mcData.blocksByName.spruce_planks?.id,
        mcData.blocksByName.birch_planks?.id,
        mcData.blocksByName.jungle_planks?.id,
        mcData.blocksByName.acacia_planks?.id,
        mcData.blocksByName.dark_oak_planks?.id
      ].filter((id) => id !== undefined) as number[];
    }
    
    if (config.allow1by1towers !== undefined) {
      movements.allow1by1towers = config.allow1by1towers;
    }
    
    if (config.allowFreeMotion !== undefined) {
      movements.allowFreeMotion = config.allowFreeMotion;
    }
    
    if (config.allowParkour !== undefined) {
      movements.allowParkour = config.allowParkour;
    }
    
    if (config.allowSprinting !== undefined) {
      movements.allowSprinting = config.allowSprinting;
    }
    
    if (config.canDig !== undefined) {
      movements.canDig = config.canDig;
    }
    
    if (config.canOpenDoors !== undefined) {
      movements.canOpenDoors = config.canOpenDoors;
    }
    
    if (config.dontCreateFlow !== undefined) {
      movements.dontCreateFlow = config.dontCreateFlow;
    }
    
    if (config.dontMineUnderFallingBlock !== undefined) {
      movements.dontMineUnderFallingBlock = config.dontMineUnderFallingBlock;
    }
    
    if (config.maxDropDown !== undefined) {
      movements.maxDropDown = config.maxDropDown;
    }
    
    if (config.infiniteLiquidDropdownDistance !== undefined) {
      movements.infiniteLiquidDropdownDistance = config.infiniteLiquidDropdownDistance;
    }
    
    bot.pathfinder.setMovements(movements);
    
    if (config.searchRadius !== undefined) {
      bot.pathfinder.searchRadius = config.searchRadius;
    }
  } catch (err) {
    console.error('Failed to configure precise pathfinder:', err);
  }
}

export function getMovementsWithToweringEnabled(bot: Bot): any {
  try {
    const { Movements } = require('mineflayer-pathfinder');
    const mcData = minecraftData(bot.version);
    
    const movements = new Movements(bot, mcData);
    movements.allow1by1towers = true;
    movements.canDig = true;
    movements.canOpenDoors = true;
    movements.allowSprinting = true;
    movements.dontCreateFlow = true;
    movements.dontMineUnderFallingBlock = true;
    movements.maxDropDown = 4;
    movements.allowFreeMotion = false;
    movements.allowParkour = false;
    
    movements.scafoldingBlocks = [
      mcData.blocksByName.dirt?.id,
      mcData.blocksByName.cobblestone?.id,
      mcData.blocksByName.stone?.id,
      mcData.blocksByName.oak_planks?.id,
      mcData.blocksByName.spruce_planks?.id,
      mcData.blocksByName.birch_planks?.id,
      mcData.blocksByName.jungle_planks?.id,
      mcData.blocksByName.acacia_planks?.id,
      mcData.blocksByName.dark_oak_planks?.id
    ].filter((id) => id !== undefined) as number[];
    
    return movements;
  } catch (err) {
    console.error('Failed to create movements with towering:', err);
    return null;
  }
}

