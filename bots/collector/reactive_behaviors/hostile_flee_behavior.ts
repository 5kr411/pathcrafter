import logger from '../../../utils/logger';
import { forceStopAllMovement } from '../../../utils/movement';
import { ReactiveBehavior, Bot } from './types';
import { findClosestCreeper, findShieldItem } from './shield_defense_behavior';
import { findClosestHostileMob } from './hostile_mob_behavior';
import { Vec3 } from 'vec3';

const { goals } = require('mineflayer-pathfinder');

const HOSTILE_FLEE_PRIORITY = 110;
const HOSTILE_FLEE_TRIGGER_RADIUS = 16;
const HOSTILE_FLEE_REACQUIRE_RADIUS = 24;
const HOSTILE_FLEE_SAFE_RADIUS = 24;
const FLEE_DISTANCE = 24;
const GOAL_CHANGE_THRESHOLD = 2;
const GOAL_REFRESH_MS = 750;

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: any) => number;
}

function hasShield(bot: Bot): boolean {
  return !!findShieldItem(bot);
}

function isLowHealth(bot: Bot): boolean {
  const entity: any = bot?.entity;
  let current = 0;
  let max: number | null = null;

  if (typeof (bot as any)?.health === 'number' && Number.isFinite((bot as any).health)) {
    current = (bot as any).health;
  } else if (typeof entity?.health === 'number' && Number.isFinite(entity.health)) {
    current = entity.health;
  }

  if (typeof (bot as any)?.maxHealth === 'number' && Number.isFinite((bot as any).maxHealth)) {
    max = (bot as any).maxHealth;
  } else if (typeof entity?.maxHealth === 'number' && Number.isFinite(entity.maxHealth)) {
    max = entity.maxHealth;
  }

  if (!Number.isFinite(max) || !max || max <= 0) {
    max = 20;
  }

  return current > 0 && current < max / 2;
}

function getDistance(a: Vec3Like, b: Vec3Like): number {
  if (typeof a.distanceTo === 'function') {
    return a.distanceTo(b);
  }
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function computeFleeTarget(botPos: Vec3Like, threatPos: Vec3Like, distance: number): Vec3 {
  let dx = botPos.x - threatPos.x;
  let dz = botPos.z - threatPos.z;
  let len = Math.sqrt(dx * dx + dz * dz);

  if (!Number.isFinite(len) || len < 0.001) {
    const angle = Math.random() * Math.PI * 2;
    dx = Math.cos(angle);
    dz = Math.sin(angle);
    len = 1;
  }

  const scale = Math.max(1, distance) / len;
  return new Vec3(botPos.x + dx * scale, botPos.y, botPos.z + dz * scale);
}

export const hostileFleeBehavior: ReactiveBehavior = {
  priority: HOSTILE_FLEE_PRIORITY,
  name: 'hostile_flee',

  shouldActivate: (bot: Bot): boolean => {
    if (hasShield(bot)) {
      return false;
    }
    const creeperThreat = findClosestCreeper(bot, HOSTILE_FLEE_TRIGGER_RADIUS);
    if (creeperThreat) {
      return true;
    }
    if (!isLowHealth(bot)) {
      return false;
    }
    const hostileThreat = findClosestHostileMob(bot, HOSTILE_FLEE_TRIGGER_RADIUS, true);
    return !!hostileThreat;
  },

  createState: (bot: Bot) => {
    const pathfinder = (bot as any)?.pathfinder;
    if (!pathfinder || typeof pathfinder.setGoal !== 'function') {
      logger.debug('HostileFlee: no pathfinder available');
      return null;
    }

    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : typeof bot?.chat === 'function'
        ? bot.chat.bind(bot)
        : null;

    let finished = false;
    let lastGoal: Vec3 | null = null;
    let lastGoalTime = 0;
    let active = false;
    let startAnnounced = false;
    let threatLabel = 'hostile mob';

    const getThreat = (): any | null => {
      const creeper = findClosestCreeper(bot, HOSTILE_FLEE_REACQUIRE_RADIUS);
      if (creeper) {
        return creeper;
      }
      if (!isLowHealth(bot)) {
        return null;
      }
      return findClosestHostileMob(bot, HOSTILE_FLEE_REACQUIRE_RADIUS, true);
    };

    const setGoal = (target: Vec3): void => {
      try {
        const goal = new goals.GoalXZ(target.x, target.z);
        pathfinder.setGoal(goal);
        lastGoal = target;
        lastGoalTime = Date.now();
      } catch (err: any) {
        logger.debug(`HostileFlee: failed to set goal - ${err?.message || err}`);
      }
    };

    const updateGoal = (threat: any, force: boolean): void => {
      const botPos = bot?.entity?.position as Vec3Like | undefined;
      const threatPos = threat?.position as Vec3Like | undefined;
      if (!botPos || !threatPos) {
        return;
      }

      const target = computeFleeTarget(botPos, threatPos, FLEE_DISTANCE);
      if (!force && lastGoal && getDistance(lastGoal, target) < GOAL_CHANGE_THRESHOLD) {
        return;
      }
      setGoal(target);
    };

    const finish = (reason: string): void => {
      if (finished) {
        return;
      }
      finished = true;
      logger.debug(`HostileFlee: finished (${reason})`);
    };

    const stateMachine = {
      stateName: 'HostileFlee',
      active: false,
      onStateEntered: () => {
        active = true;
        (stateMachine as any).active = true;
        finished = false;
        lastGoal = null;
        lastGoalTime = 0;

        const threat = getThreat();
        if (!threat) {
          finish('no hostile on enter');
          return;
        }
        threatLabel = String(threat.displayName || threat.name || 'hostile mob');
        if (!startAnnounced && sendChat) {
          try {
            sendChat(`fleeing ${threatLabel}`);
          } catch (_) {}
          startAnnounced = true;
        }
        updateGoal(threat, true);
      },
      update: () => {
        if (finished || !active) {
          return;
        }

        if (hasShield(bot)) {
          finish('shield acquired');
          return;
        }

        const threat = getThreat();
        if (!threat) {
          finish(isLowHealth(bot) ? 'hostile lost' : 'health recovered');
          return;
        }

        const botPos = bot?.entity?.position as Vec3Like | undefined;
        const threatPos = threat?.position as Vec3Like | undefined;
        if (!botPos || !threatPos) {
          finish('missing positions');
          return;
        }

        const distance = getDistance(botPos, threatPos);
        if (distance >= HOSTILE_FLEE_SAFE_RADIUS) {
          finish('safe distance reached');
          return;
        }

        const now = Date.now();
        if (!lastGoal || now - lastGoalTime >= GOAL_REFRESH_MS) {
          updateGoal(threat, false);
        }
      },
      isFinished: () => finished,
      onStateExited: () => {
        active = false;
        (stateMachine as any).active = false;
        forceStopAllMovement(bot, 'hostile flee exit');
      }
    };

    return {
      stateMachine,
      isFinished: () => finished,
      onStop: (reason) => {
        if (!startAnnounced || !sendChat) {
          return;
        }
        const verb = reason === 'completed'
          ? 'done fleeing'
          : reason === 'preempted'
            ? 'pausing flee'
            : 'stopped fleeing';
        try {
          sendChat(`${verb} ${threatLabel}`);
        } catch (_) {}
      }
    };
  }
};
