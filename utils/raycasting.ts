import { Vec3 } from 'vec3';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: any) => number;
}

export interface MinecraftBlock {
  name?: string;
  position?: Vec3Like;
  [key: string]: any;
}

export interface MinecraftBot {
  entity?: {
    position: Vec3Like;
  };
  world?: {
    getBlockType: (pos: any) => number;
  };
  blockAt?: (pos: any, extraInfos?: boolean) => MinecraftBlock | null;
  canDigBlock?: (block: any) => boolean;
  canSeeBlock?: (block: any) => boolean;
}

export interface CollectTargets {
  blockPosition?: Vec3Like | null;
  position?: Vec3Like | null;
  blockName?: string;
}

/**
 * Check if the bot can see the target block using line-of-sight
 */
export function canSeeTargetBlock(bot: MinecraftBot, targets: CollectTargets): boolean {
  if (!targets.blockPosition) return false;
  try {
    // First try using the bot's built-in canSeeBlock if available (more accurate)
    if (typeof bot.canSeeBlock === 'function' && bot.blockAt) {
      const targetBlock = bot.blockAt(targets.blockPosition, false);
      if (targetBlock) {
        const canSee = bot.canSeeBlock(targetBlock);
        if (!canSee) {
          // Double-check with our own raycast to see if there are obstructions
          const obstruction = findObstructingBlock(bot, targets);
          if (obstruction) {
            return false; // Confirmed obstruction
          }
          // Bot says can't see but we found no obstructions - trust the bot
          return false;
        }
        return true;
      }
    }
    
    // Fallback: use our own obstruction detection
    // If we find ANY obstructions, we can't see the target
    const obstruction = findObstructingBlock(bot, targets);
    return obstruction === null;
  } catch (err) {
    return true; // Assume visible if check fails
  }
}

/**
 * Find the closest obstructing block between the bot and the target using DDA voxel traversal.
 * Returns the closest visible obstruction that can be mined.
 */
export function findObstructingBlock(bot: MinecraftBot, targets: CollectTargets): MinecraftBlock | null {
  if (!targets.blockPosition) return null;
  try {
    if (!bot.entity || !bot.world || !bot.blockAt) return null;
    
    const botPos = bot.entity.position;
    const blockPos = targets.blockPosition;
    const eyePos = new Vec3(botPos.x, botPos.y + 1.5, botPos.z); // Bot's eye level (1.5 blocks above feet)
    const targetCenter = new Vec3(blockPos.x + 0.5, blockPos.y + 0.5, blockPos.z + 0.5);
    
    // Use DDA-style voxel traversal to find ALL blocks along the ray
    const dx = targetCenter.x - eyePos.x;
    const dy = targetCenter.y - eyePos.y;
    const dz = targetCenter.z - eyePos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (distance < 0.01) return null; // Too close
    
    // Normalize direction
    const dirX = dx / distance;
    const dirY = dy / distance;
    const dirZ = dz / distance;
    
    // DDA traversal - step through each voxel the ray passes through
    let currentX = Math.floor(eyePos.x);
    let currentY = Math.floor(eyePos.y);
    let currentZ = Math.floor(eyePos.z);
    
    const targetX = Math.floor(targetCenter.x);
    const targetY = Math.floor(targetCenter.y);
    const targetZ = Math.floor(targetCenter.z);
    
    const stepX = dirX > 0 ? 1 : -1;
    const stepY = dirY > 0 ? 1 : -1;
    const stepZ = dirZ > 0 ? 1 : -1;
    
    const tDeltaX = Math.abs(1 / dirX);
    const tDeltaY = Math.abs(1 / dirY);
    const tDeltaZ = Math.abs(1 / dirZ);
    
    let tMaxX = dirX !== 0 ? Math.abs((currentX + (dirX > 0 ? 1 : 0) - eyePos.x) / dirX) : Infinity;
    let tMaxY = dirY !== 0 ? Math.abs((currentY + (dirY > 0 ? 1 : 0) - eyePos.y) / dirY) : Infinity;
    let tMaxZ = dirZ !== 0 ? Math.abs((currentZ + (dirZ > 0 ? 1 : 0) - eyePos.z) / dirZ) : Infinity;
    
    const obstructions: Array<{ block: MinecraftBlock; distance: number }> = [];
    const visited = new Set<string>();
    const maxSteps = Math.ceil(distance) + 10; // Safety limit
    
    for (let step = 0; step < maxSteps; step++) {
      // Check if we've reached the target block
      if (currentX === targetX && currentY === targetY && currentZ === targetZ) {
        break;
      }
      
      const key = `${currentX},${currentY},${currentZ}`;
      if (!visited.has(key)) {
        visited.add(key);
        
        // Skip blocks at bot's position to avoid detecting ourselves
        // Bot occupies 2 blocks vertically: feet at Y and body/head at Y+1 (eyes are at Y+1.5)
        const botBlockX = Math.floor(botPos.x);
        const botBlockY = Math.floor(botPos.y);
        const botBlockZ = Math.floor(botPos.z);
        const isBotBlock = currentX === botBlockX && currentZ === botBlockZ && 
                          (currentY === botBlockY || currentY === botBlockY + 1);
        
        if (isBotBlock) {
          // Skip this block, continue DDA
        } else {
          const checkPos = new Vec3(currentX, currentY, currentZ);
          const blockType = bot.world.getBlockType(checkPos);
          
          if (blockType !== 0) {
            const block = bot.blockAt(checkPos, false);
            if (block) {
              const canDig = typeof bot.canDigBlock === 'function' ? bot.canDigBlock(block) : true;
              if (canDig) {
                // Ensure block has position property
                if (!block.position) {
                  block.position = { x: checkPos.x, y: checkPos.y, z: checkPos.z };
                }
                const dist = typeof eyePos.distanceTo === 'function' ? eyePos.distanceTo(checkPos) : 
                            Math.sqrt(Math.pow(eyePos.x - checkPos.x, 2) + 
                                     Math.pow(eyePos.y - checkPos.y, 2) + 
                                     Math.pow(eyePos.z - checkPos.z, 2));
                obstructions.push({ block, distance: dist });
              }
            }
          }
        }
      }
      
      // Step to next voxel
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          currentX += stepX;
          tMaxX += tDeltaX;
        } else {
          currentZ += stepZ;
          tMaxZ += tDeltaZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          currentY += stepY;
          tMaxY += tDeltaY;
        } else {
          currentZ += stepZ;
          tMaxZ += tDeltaZ;
        }
      }
    }
    
    // Filter by which obstructions the bot can actually see
    if (obstructions.length > 0) {
      const visibleObstructions = obstructions.filter(obs => {
        if (typeof bot.canSeeBlock === 'function') {
          try {
            return bot.canSeeBlock(obs.block);
          } catch (_) {
            return true; // Assume visible if check fails
          }
        }
        return true;
      });
      
      if (visibleObstructions.length > 0) {
        // Return the closest visible obstruction
        visibleObstructions.sort((a, b) => a.distance - b.distance);
        return visibleObstructions[0].block;
      }
      
      // If no visible obstructions, return the closest one anyway
      obstructions.sort((a, b) => a.distance - b.distance);
      return obstructions[0].block;
    }
    
    return null;
  } catch (err) {
    return null;
  }
}

