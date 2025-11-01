const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import createRotateState from './behaviorRotate';

// Calculate the nearest point on an entity's bounding box to the bot
function getNearestPointOnEntityBoundingBox(botPos: any, entity: any): any {
  if (!entity.position) return entity.position;
  
  const entityPos = entity.position;
  const width = entity.width || 0.6; // Default to 0.6 if not available
  const height = entity.height || 1.8; // Default to 1.8 if not available
  
  // Entity bounding box is centered horizontally on entity.position
  const halfWidth = width / 2;
  
  // Calculate bounding box bounds
  const minX = entityPos.x - halfWidth;
  const maxX = entityPos.x + halfWidth;
  const minY = entityPos.y;
  const maxY = entityPos.y + height;
  const minZ = entityPos.z - halfWidth;
  const maxZ = entityPos.z + halfWidth;
  
  // Clamp bot position to bounding box to find nearest point
  const nearestX = Math.max(minX, Math.min(maxX, botPos.x));
  const nearestY = Math.max(minY, Math.min(maxY, botPos.y));
  const nearestZ = Math.max(minZ, Math.min(maxZ, botPos.z));
  
  return {
    x: nearestX,
    y: nearestY,
    z: nearestZ
  };
}

interface Bot {
  entity?: {
    position: any;
    yaw: number;
    pitch: number;
  };
  look?: (yaw: number, pitch: number, force?: boolean) => void;
  [key: string]: any;
}

interface Targets {
  position?: any; // Vec3-like object with x, y, z
  targetYaw?: number;
  targetPitch?: number;
  [key: string]: any;
}

function createLookAtState(bot: Bot, targets: Targets, rotationSpeed: number = 3.0, initialEntity: any = null): any {
  const enter = new BehaviorIdle();
  
  // Create rotation targets object for the rotate state
  const rotateTargets: Targets = {
    targetYaw: undefined,
    targetPitch: undefined
  };
  
  const rotate = createRotateState(bot, rotateTargets, rotationSpeed);
  const exit = new BehaviorIdle();
  
  // Store entity reference that can be updated by transitions
  let entity = initialEntity;

  const enterToRotate = new StateTransition({
    parent: enter,
    child: rotate,
    name: 'BehaviorLookAt: enter -> rotate',
    shouldTransition: () => true,
    onTransition: () => {
      // Calculate target angles from position
      if (!bot.entity?.position) {
        logger.info('BehaviorLookAt: missing bot position');
        rotateTargets.targetYaw = bot.entity?.yaw || 0;
        rotateTargets.targetPitch = bot.entity?.pitch || 0;
        return;
      }

      const botPos = bot.entity.position;
      const botEyeHeight = 1.62; // Standard player eye height in Minecraft
      const botEyePos = {
        x: botPos.x,
        y: botPos.y + botEyeHeight,
        z: botPos.z
      };
      let lookTarget;

      // Update entity from state machine if it was set externally
      const currentEntity = (stateMachine as any).entity;
      
      // If entity is provided, calculate nearest point on bounding box from eye position
      if (currentEntity) {
        lookTarget = getNearestPointOnEntityBoundingBox(botEyePos, currentEntity);
        logger.info(`BehaviorLookAt: looking at nearest point on entity bounding box at (${lookTarget.x.toFixed(1)}, ${lookTarget.y.toFixed(1)}, ${lookTarget.z.toFixed(1)})`);
      } else if (targets.position) {
        lookTarget = targets.position;
        logger.info(`BehaviorLookAt: looking at position (${lookTarget.x.toFixed(1)}, ${lookTarget.y.toFixed(1)}, ${lookTarget.z.toFixed(1)})`);
      } else {
        logger.info('BehaviorLookAt: missing position data');
        rotateTargets.targetYaw = bot.entity?.yaw || 0;
        rotateTargets.targetPitch = bot.entity?.pitch || 0;
        return;
      }

      const dx = lookTarget.x - botEyePos.x;
      const dy = lookTarget.y - botEyePos.y;
      const dz = lookTarget.z - botEyePos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Calculate yaw and pitch
      // In Minecraft: positive pitch = look down, negative pitch = look up
      rotateTargets.targetYaw = Math.atan2(-dx, -dz);
      rotateTargets.targetPitch = Math.asin(dy / distance);

      logger.info(`BehaviorLookAt: target angles - yaw: ${rotateTargets.targetYaw.toFixed(3)}, pitch: ${rotateTargets.targetPitch.toFixed(3)}`);
    }
  });

  const rotateToExit = new StateTransition({
    parent: rotate,
    child: exit,
    name: 'BehaviorLookAt: rotate -> exit',
    shouldTransition: () => {
      if (typeof rotate.isFinished === 'function') {
        return rotate.isFinished();
      }
      return rotate.isFinished === true;
    },
    onTransition: () => {
      logger.info('BehaviorLookAt: rotation finished');
    }
  });

  const transitions = [enterToRotate, rotateToExit];
  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  addStateLogging(stateMachine, 'LookAt', {
    logEnter: true,
    logExit: true,
    getExtraInfo: () => {
      const currentEntity = (stateMachine as any).entity;
      if (currentEntity) {
        return `at entity (${currentEntity.name || currentEntity.displayName || 'unknown'})`;
      } else if (targets.position) {
        const pos = targets.position;
        return `at position (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
      }
      return 'no target';
    }
  });
  
  // Add entity property so it can be updated from outside
  (stateMachine as any).entity = entity;

  return stateMachine;
}

export default createLookAtState;

