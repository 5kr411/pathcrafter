import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';

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
  targetYaw?: number;
  targetPitch?: number;
  [key: string]: any;
}

// Calculate point on a cubic bezier curve at time t (0 to 1)
function bezierPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const oneMinusT = 1 - t;
  return (
    oneMinusT * oneMinusT * oneMinusT * p0 +
    3 * oneMinusT * oneMinusT * t * p1 +
    3 * oneMinusT * t * t * p2 +
    t * t * t * p3
  );
}

// Ease-in-ease-out cubic function for smooth acceleration/deceleration
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Normalize angle to -PI to PI range
function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

class BehaviorRotateState {
  bot: Bot;
  targets: Targets;
  isFinished: boolean = false;
  rotationSpeed: number; // radians per second
  
  // Bezier curve control points
  startYaw: number = 0;
  startPitch: number = 0;
  targetYaw: number = 0;
  targetPitch: number = 0;
  p1Yaw: number = 0;
  p1Pitch: number = 0;
  p2Yaw: number = 0;
  p2Pitch: number = 0;
  
  // Animation progress
  progress: number = 0;
  totalDistance: number = 0;
  estimatedDuration: number = 0; // milliseconds
  startTime: number = 0;
  
  tickInterval: any = null;

  constructor(bot: Bot, targets: Targets, rotationSpeed: number = 3.0) {
    this.bot = bot;
    this.targets = targets;
    this.rotationSpeed = rotationSpeed;
  }

  // Generate random control point within the box formed by start and end
  generateControlPoint(start: number, end: number, closerTo: 'start' | 'end'): number {
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    const range = max - min;
    
    if (closerTo === 'start') {
      // Closer to start: 0-30% along the path
      const t = Math.random() * 0.3;
      return start + (end - start) * t + (Math.random() - 0.5) * range * 0.3;
    } else {
      // Closer to end: 70-100% along the path
      const t = 0.7 + Math.random() * 0.3;
      return start + (end - start) * t + (Math.random() - 0.5) * range * 0.3;
    }
  }

  onStateEntered(): void {
    this.isFinished = false;
    this.progress = 0;

    if (!this.bot.entity) {
      logger.debug('BehaviorRotate: no bot entity');
      this.isFinished = true;
      return;
    }

    if (this.targets.targetYaw === undefined || this.targets.targetPitch === undefined) {
      logger.debug('BehaviorRotate: no target angles');
      this.isFinished = true;
      return;
    }

    // Get current and target angles
    this.startYaw = normalizeAngle(this.bot.entity.yaw);
    this.startPitch = normalizeAngle(this.bot.entity.pitch);
    let targetYaw = normalizeAngle(this.targets.targetYaw);
    let targetPitch = normalizeAngle(this.targets.targetPitch);

    // Adjust target angles to ensure shortest path
    // If the difference is > π, we should wrap around the other way
    let yawDiff = targetYaw - this.startYaw;
    if (yawDiff > Math.PI) {
      targetYaw -= 2 * Math.PI;
    } else if (yawDiff < -Math.PI) {
      targetYaw += 2 * Math.PI;
    }

    let pitchDiff = targetPitch - this.startPitch;
    if (pitchDiff > Math.PI) {
      targetPitch -= 2 * Math.PI;
    } else if (pitchDiff < -Math.PI) {
      targetPitch += 2 * Math.PI;
    }

    this.targetYaw = targetYaw;
    this.targetPitch = targetPitch;

    // Calculate angular distance (now guaranteed to be shortest path)
    const yawDist = Math.abs(this.targetYaw - this.startYaw);
    const pitchDist = Math.abs(this.targetPitch - this.startPitch);
    this.totalDistance = Math.sqrt(yawDist * yawDist + pitchDist * pitchDist);

    // Check if already aligned
    if (this.totalDistance < 0.05) {
      logger.debug('BehaviorRotate: already aligned');
      this.isFinished = true;
      return;
    }

    // Generate bezier control points
    this.p1Yaw = this.generateControlPoint(this.startYaw, this.targetYaw, 'start');
    this.p1Pitch = this.generateControlPoint(this.startPitch, this.targetPitch, 'start');
    this.p2Yaw = this.generateControlPoint(this.startYaw, this.targetYaw, 'end');
    this.p2Pitch = this.generateControlPoint(this.startPitch, this.targetPitch, 'end');

    // Estimate duration based on rotation speed
    this.estimatedDuration = (this.totalDistance / this.rotationSpeed) * 1000; // convert to ms
    this.startTime = Date.now();

    logger.info(`BehaviorRotate: rotating from (yaw: ${this.startYaw.toFixed(3)}, pitch: ${this.startPitch.toFixed(3)}) to (yaw: ${this.targetYaw.toFixed(3)}, pitch: ${this.targetPitch.toFixed(3)}), estimated duration: ${this.estimatedDuration.toFixed(0)}ms`);

    // Start tick updates
    this.startTicking();
  }

  startTicking(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }

    this.tickInterval = setInterval(() => {
      this.tick();
    }, 50); // Update every 50ms
  }

  tick(): void {
    if (this.isFinished) {
      this.stopTicking();
      return;
    }

    // Calculate progress based on elapsed time
    const elapsed = Date.now() - this.startTime;
    const linearProgress = Math.min(elapsed / this.estimatedDuration, 1.0);
    
    // Apply easing for smooth acceleration/deceleration
    this.progress = easeInOutCubic(linearProgress);

    // Calculate current angles using bezier curves
    const currentYaw = bezierPoint(
      this.progress,
      this.startYaw,
      this.p1Yaw,
      this.p2Yaw,
      this.targetYaw
    );
    const currentPitch = bezierPoint(
      this.progress,
      this.startPitch,
      this.p1Pitch,
      this.p2Pitch,
      this.targetPitch
    );

    // Apply rotation
    if (this.bot.look) {
      this.bot.look(currentYaw, currentPitch, true);
    }

    // Check if finished
    if (this.progress >= 1.0) {
      // Ensure final angles are exactly the target
      if (this.bot.look) {
        this.bot.look(this.targetYaw, this.targetPitch, true);
      }
      logger.info('BehaviorRotate: rotation complete');
      this.isFinished = true;
      this.stopTicking();
    }
  }

  stopTicking(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  onStateExited(): void {
    this.stopTicking();
    this.isFinished = false;
  }
}

function createRotateState(bot: Bot, targets: Targets, rotationSpeed: number = 3.0): any {
  const rotateState = new BehaviorRotateState(bot, targets, rotationSpeed);

  addStateLogging(rotateState, 'Rotate', {
    logEnter: true,
    logExit: true,
    getExtraInfo: () => {
      if (targets.targetYaw !== undefined && targets.targetPitch !== undefined) {
        return `to yaw ${targets.targetYaw.toFixed(2)}, pitch ${targets.targetPitch.toFixed(2)}`;
      }
      return 'no target';
    }
  });

  return rotateState;
}

export default createRotateState;

