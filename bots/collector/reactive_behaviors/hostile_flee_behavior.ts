import logger from '../../../utils/logger';
import { forceStopAllMovement } from '../../../utils/movement';
import { ReactiveBehavior, Bot } from './types';
import { findClosestCreeper, findShieldItem, isShieldUsable } from './shield_defense_behavior';
import { findClosestHostileMob, isRangedHostile } from './hostile_mob_behavior';
import { Vec3 } from 'vec3';

const { goals } = require('mineflayer-pathfinder');

const HOSTILE_FLEE_PRIORITY = 110;
const TRIGGER_RADIUS = 16;
const FLEE_RADIUS = 32;
const GOAL_CHANGE_THRESHOLD = 2;
const GOAL_REFRESH_MS = 750;
export const FLEE_MEMORY_MS = 5000;
const LOW_ARMOR_THRESHOLD = 10;
const LOW_HEALTH_RATIO = 0.6;

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: any) => number;
}

function hasUsableShield(bot: Bot): boolean {
  const shield = findShieldItem(bot);
  if (!shield) return false;
  return isShieldUsable(shield);
}

function getArmorValue(bot: Bot): number {
  const attr = (bot as any)?.entity?.attributes?.['generic.armor'];
  if (attr && typeof attr.value === 'number') return attr.value;
  return 0;
}

function isLowArmor(bot: Bot): boolean {
  return getArmorValue(bot) < LOW_ARMOR_THRESHOLD;
}

function isLowHealth(bot: Bot): boolean {
  const current = (bot as any).health ?? 20;
  const max = (bot as any).maxHealth ?? 20;
  return current > 0 && current < max * LOW_HEALTH_RATIO;
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
    if (hasUsableShield(bot)) {
      return false;
    }
    const creeperThreat = findClosestCreeper(bot, TRIGGER_RADIUS);
    if (creeperThreat) {
      return true;
    }
    // Ranged hostiles: flee if low armor OR low health
    const rangedThreat = findClosestHostileMob(bot, TRIGGER_RADIUS, true, isRangedHostile);
    if (rangedThreat && (isLowArmor(bot) || isLowHealth(bot))) {
      return true;
    }
    if (!isLowHealth(bot)) {
      return false;
    }
    const hostileThreat = findClosestHostileMob(bot, TRIGGER_RADIUS, true);
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
    let lastKnownThreatPos: Vec3Like | null = null;
    let lastThreatSeenTime = 0;

    const getThreat = (): any | null => {
      const creeper = findClosestCreeper(bot, FLEE_RADIUS);
      if (creeper) return creeper;
      const ranged = findClosestHostileMob(bot, FLEE_RADIUS, true, isRangedHostile);
      if (ranged && (isLowArmor(bot) || isLowHealth(bot))) return ranged;
      if (!isLowHealth(bot)) return null;
      return findClosestHostileMob(bot, FLEE_RADIUS, true);
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

    const updateGoal = (threatPos: Vec3Like, force: boolean): void => {
      const botPos = bot?.entity?.position as Vec3Like | undefined;
      if (!botPos) {
        return;
      }

      const target = computeFleeTarget(botPos, threatPos, FLEE_RADIUS);
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
        lastKnownThreatPos = null;
        lastThreatSeenTime = 0;

        const threat = getThreat();
        if (!threat) {
          finish('no hostile on enter');
          return;
        }
        threatLabel = String(threat.displayName || threat.name || 'hostile mob');
        lastKnownThreatPos = { x: threat.position.x, y: threat.position.y, z: threat.position.z };
        lastThreatSeenTime = Date.now();
        if (!startAnnounced && sendChat) {
          try {
            sendChat(`fleeing ${threatLabel}`);
          } catch (_) {}
          startAnnounced = true;
        }
        updateGoal(threat.position, true);
      },
      update: () => {
        if (finished || !active) {
          return;
        }

        if (hasUsableShield(bot)) {
          finish('shield acquired');
          return;
        }

        const botPos = bot?.entity?.position as Vec3Like | undefined;
        if (!botPos) {
          finish('missing positions');
          return;
        }

        const now = Date.now();
        const threat = getThreat();

        let currentThreatPos: Vec3Like;

        if (threat) {
          currentThreatPos = threat.position;
          lastKnownThreatPos = { x: threat.position.x, y: threat.position.y, z: threat.position.z };
          lastThreatSeenTime = now;
        } else if (lastKnownThreatPos && now - lastThreatSeenTime < FLEE_MEMORY_MS) {
          currentThreatPos = lastKnownThreatPos;
        } else {
          finish(isLowHealth(bot) ? 'hostile lost' : 'health recovered');
          return;
        }

        const distance = getDistance(botPos, currentThreatPos);
        if (distance >= FLEE_RADIUS) {
          finish('safe distance reached');
          return;
        }

        if (!lastGoal || now - lastGoalTime >= GOAL_REFRESH_MS) {
          updateGoal(currentThreatPos, false);
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
        sendChat(`${verb} ${threatLabel}`);
      }
    };
  }
};
