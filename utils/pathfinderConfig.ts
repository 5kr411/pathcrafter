const minecraftData = require('minecraft-data');
import { getLiquidAvoidanceDistance } from './config';

interface Bot {
  version: string;
  pathfinder: any;
  entity?: any;
  [key: string]: any;
}

export function createLiquidAvoidanceExclusion(bot: Bot, range: number = 1): (block: any) => number {
  const mcData = minecraftData(bot.version);
  const waterIds = new Set([
    mcData.blocksByName.water?.id,
    mcData.blocksByName.flowing_water?.id
  ].filter((id) => id !== undefined));
  
  const lavaIds = new Set([
    mcData.blocksByName.lava?.id,
    mcData.blocksByName.flowing_lava?.id
  ].filter((id) => id !== undefined));
  
  return (block: any) => {
    if (!block || !block.position) return 0;
    
    const pos = block.position;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        for (let dz = -range; dz <= range; dz++) {
          const checkBlock = bot.blockAt(pos.offset(dx, dy, dz));
          if (!checkBlock) continue;
          
          if (lavaIds.has(checkBlock.type)) {
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            return Math.max(0, 50 * (1 - distance / range));
          }
          
          if (waterIds.has(checkBlock.type)) {
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            return Math.max(0, 30 * (1 - distance / range));
          }
        }
      }
    }
    
    return 0;
  };
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
  avoidWater?: boolean;
  avoidLava?: boolean;
  dontBreakDripstone?: boolean;
  placeCost?: number;
  breakCost?: number;
  exclusionAreasStep?: Array<(block: any) => number>;
  exclusionAreasBreak?: Array<(block: any) => number>;
  exclusionAreasPlace?: Array<(block: any) => number>;
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
  infiniteLiquidDropdownDistance: false,
  avoidWater: true,
  avoidLava: true,
  dontBreakDripstone: true,
  placeCost: 1,
  breakCost: 1
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
    
    if (config.avoidWater !== false || config.avoidLava !== false) {
      if (!movements.blocksToAvoid) {
        movements.blocksToAvoid = new Set();
      }
      
      if (config.avoidWater !== false) {
        const waterIds = [
          mcData.blocksByName.water?.id,
          mcData.blocksByName.flowing_water?.id
        ].filter((id) => id !== undefined);
        waterIds.forEach((id) => movements.blocksToAvoid.add(id));
      }
      
      if (config.avoidLava !== false) {
        const lavaIds = [
          mcData.blocksByName.lava?.id,
          mcData.blocksByName.flowing_lava?.id
        ].filter((id) => id !== undefined);
        lavaIds.forEach((id) => movements.blocksToAvoid.add(id));
      }
      
      if (!movements.exclusionAreasStep) {
        movements.exclusionAreasStep = [];
      }
      const avoidanceRadius = getLiquidAvoidanceDistance();
      const liquidAvoidance = createLiquidAvoidanceExclusion(bot, avoidanceRadius);
      movements.exclusionAreasStep.push(liquidAvoidance);
      
      if (!movements.exclusionAreasBreak) {
        movements.exclusionAreasBreak = [];
      }
      movements.exclusionAreasBreak.push(liquidAvoidance);
    }
    
    if (config.exclusionAreasStep && config.exclusionAreasStep.length > 0) {
      if (!movements.exclusionAreasStep) {
        movements.exclusionAreasStep = [];
      }
      movements.exclusionAreasStep.push(...config.exclusionAreasStep);
    }
    
    if (config.exclusionAreasBreak) {
      if (!movements.exclusionAreasBreak) {
        movements.exclusionAreasBreak = [];
      }
      movements.exclusionAreasBreak.push(...config.exclusionAreasBreak);
    }
    
    if (config.exclusionAreasPlace) {
      if (!movements.exclusionAreasPlace) {
        movements.exclusionAreasPlace = [];
      }
      movements.exclusionAreasPlace.push(...config.exclusionAreasPlace);
    }
    
    if (config.dontBreakDripstone !== false) {
      if (!movements.blocksCantBreak) {
        movements.blocksCantBreak = new Set();
      }
      
      const dripstoneIds = [
        mcData.blocksByName.dripstone_block?.id,
        mcData.blocksByName.pointed_dripstone?.id
      ].filter((id) => id !== undefined);
      dripstoneIds.forEach((id) => movements.blocksCantBreak.add(id));
    }
    
    if (config.placeCost !== undefined) {
      movements.placeCost = config.placeCost;
    }
    
    if (config.breakCost !== undefined) {
      movements.breakCost = config.breakCost;
    }
    
    bot.pathfinder.setMovements(movements);
    
    if (config.searchRadius !== undefined) {
      bot.pathfinder.searchRadius = config.searchRadius;
    }
  } catch (err) {
    console.error('Failed to configure precise pathfinder:', err);
  }
}
