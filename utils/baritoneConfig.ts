interface Bot {
  version: string;
  ashfinder?: any;
  entity?: any;
  [key: string]: any;
}

export interface BaritoneConfig {
  parkour?: boolean;
  breakBlocks?: boolean;
  placeBlocks?: boolean;
  swimming?: boolean;
  maxFallDist?: number;
  maxWaterDist?: number;
  disposableBlocks?: string[];
  blocksToAvoid?: string[];
  thinkTimeout?: number;
  debug?: boolean;
  goalReachedDistance?: number;
  blockReach?: number;
  entityReach?: number;
}

export const PRECISE_BARITONE_CONFIG: BaritoneConfig = {
  parkour: true,
  breakBlocks: true,
  placeBlocks: true,
  swimming: true,
  maxFallDist: 4,
  maxWaterDist: 256,
  disposableBlocks: [
    'dirt',
    'cobblestone',
    'stone',
    'andesite',
    'oak_planks',
    'spruce_planks',
    'birch_planks',
    'jungle_planks',
    'acacia_planks',
    'dark_oak_planks',
    'grass_block'
  ],
  blocksToAvoid: [
    'crafting_table',
    'chest',
    'furnace'
  ],
  thinkTimeout: 60000,
  debug: false,
  goalReachedDistance: 3.5,
  blockReach: 4.5,
  entityReach: 3
};

export function configureBaritone(
  bot: Bot,
  customConfig?: Partial<BaritoneConfig>
): void {
  if (!bot.ashfinder) {
    console.warn('Baritone (ashfinder) not loaded on bot');
    return;
  }

  try {
    const config = { ...PRECISE_BARITONE_CONFIG, ...customConfig };
    
    if (config.parkour !== undefined) {
      bot.ashfinder.config.parkour = config.parkour;
    }
    
    if (config.breakBlocks !== undefined) {
      if (config.breakBlocks) {
        bot.ashfinder.enableBreaking();
      } else {
        bot.ashfinder.disableBreaking();
      }
    }
    
    if (config.placeBlocks !== undefined) {
      if (config.placeBlocks) {
        bot.ashfinder.enablePlacing();
      } else {
        bot.ashfinder.disablePlacing();
      }
    }
    
    if (config.swimming !== undefined) {
      bot.ashfinder.config.swimming = config.swimming;
    }
    
    if (config.maxFallDist !== undefined) {
      bot.ashfinder.config.maxFallDist = config.maxFallDist;
    }
    
    if (config.maxWaterDist !== undefined) {
      bot.ashfinder.config.maxWaterDist = config.maxWaterDist;
    }
    
    if (config.disposableBlocks !== undefined) {
      bot.ashfinder.config.disposableBlocks = config.disposableBlocks;
    }
    
    if (config.blocksToAvoid !== undefined) {
      bot.ashfinder.config.blocksToAvoid = config.blocksToAvoid;
    }
    
    if (config.thinkTimeout !== undefined) {
      bot.ashfinder.config.thinkTimeout = config.thinkTimeout;
    }
    
    if (config.debug !== undefined) {
      bot.ashfinder.debug = config.debug;
    }
    
    if (config.goalReachedDistance !== undefined) {
      bot.ashfinder.config.goalReachedDistance = config.goalReachedDistance;
    }
    
    if (config.blockReach !== undefined) {
      bot.ashfinder.config.blockReach = config.blockReach;
    }
    
    if (config.entityReach !== undefined) {
      bot.ashfinder.config.entityReach = config.entityReach;
    }
  } catch (err) {
    console.error('Failed to configure baritone:', err);
  }
}

