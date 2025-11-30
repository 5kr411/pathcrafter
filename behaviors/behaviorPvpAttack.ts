import { StateBehavior } from 'mineflayer-statemachine';
import logger from '../utils/logger';

interface Bot {
  entity?: {
    position: any;
  };
  pvp?: {
    attack: (entity: any) => void;
    stop: () => void;
    forceStop: () => void;
    target: any;
    movements: any;
    followRange: number;
    viewDistance: number;
    attackRange: number;
    meleeAttackRate: any;
  };
  inventory?: {
    items?: () => any[];
  };
  registry?: {
    items?: Record<string, any>;
  };
  equip?: (item: any, destination: string) => Promise<void>;
  on: (event: string, listener: (...args: any[]) => void) => void;
  off: (event: string, listener: (...args: any[]) => void) => void;
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
  [key: string]: any;
}

function pickBestWeapon(bot: Bot): any | null {
  const items = bot.inventory?.items?.() || [];
  const registry = bot.registry?.items ?? {};

  type WeaponDescriptor = {
    matches: (name: string) => boolean;
    type: 'sword' | 'axe' | 'trident' | 'bow' | 'crossbow';
    baseScore: number;
  };

  const descriptors: WeaponDescriptor[] = [
    { matches: (name) => name.endsWith('_sword'), type: 'sword', baseScore: 400 },
    { matches: (name) => name.endsWith('_axe'), type: 'axe', baseScore: 320 },
    { matches: (name) => name === 'trident', type: 'trident', baseScore: 300 },
    { matches: (name) => name === 'bow', type: 'bow', baseScore: 200 },
    { matches: (name) => name === 'crossbow', type: 'crossbow', baseScore: 180 }
  ];

  const materialPriority = new Map<string, number>([
    ['netherite', 70],
    ['diamond', 60],
    ['iron', 50],
    ['stone', 40],
    ['golden', 35],
    ['gold', 35],
    ['copper', 33],
    ['wooden', 25],
    ['wood', 25]
  ]);

  const getMaterialScore = (itemName: string): number => {
    const prefix = itemName.split('_')[0];
    return materialPriority.get(prefix) ?? 0;
  };

  let bestWeapon: any = null;
  let bestScore = -Infinity;

  for (const item of items) {
    if (!item || !item.name) continue;

    const descriptor = descriptors.find((desc) => desc.matches(item.name));
    if (!descriptor) continue;

    const attackDamage = registry[item.type]?.attackDamage ?? 0;
    const materialScore = getMaterialScore(item.name);

    const score = descriptor.baseScore + attackDamage * 10 + materialScore;

    if (score > bestScore) {
      bestScore = score;
      bestWeapon = item;
    }
  }

  return bestWeapon;
}

interface Entity {
  position?: any;
  health?: number;
  name?: string;
  displayName?: string;
  id?: number;
  [key: string]: any;
}

interface Targets {
  entity?: Entity | null;
  attackRange?: number;
  followRange?: number;
  viewDistance?: number;
  [key: string]: any;
}

export interface PvpAttackConfig {
  singleAttack?: boolean;
  attackRange?: number;
  followRange?: number;
  viewDistance?: number;
  onAttackPerformed?: () => void;
  onStopped?: (reason: 'completed' | 'manual' | 'target_lost') => void;
}

export class BehaviorPvpAttack implements StateBehavior {
  public stateName = 'BehaviorPvpAttack';
  public active = false;
  
  private bot: Bot;
  private targets: Targets;
  private config: PvpAttackConfig;
  private finished = false;
  private attackCount = 0;
  
  private stoppedAttackingHandler: (() => void) | null = null;
  private attackedTargetHandler: (() => void) | null = null;

  constructor(bot: Bot, targets: Targets, config: PvpAttackConfig = {}) {
    this.bot = bot;
    this.targets = targets;
    this.config = config;
  }

  onStateEntered(): void {
    this.finished = false;
    this.active = true;
    this.attackCount = 0;

    if (!this.bot.pvp) {
      logger.warn('BehaviorPvpAttack: pvp plugin not loaded on bot');
      this.finished = true;
      return;
    }

    const entity = this.targets.entity;
    if (!entity) {
      logger.info('BehaviorPvpAttack: no entity target');
      this.finished = true;
      return;
    }

    this.configurePvp();
    this.attachEventListeners();

    const entityName = entity.name || entity.displayName || 'entity';
    logger.info(`BehaviorPvpAttack: starting attack on ${entityName}${this.config.singleAttack ? ' (single attack mode)' : ''}`);

    this.equipAndAttack(entity).catch((err: any) => {
      logger.warn(`BehaviorPvpAttack: failed to start attack - ${err?.message || err}`);
      this.cleanup();
      this.finished = true;
    });
  }

  private async equipAndAttack(entity: Entity): Promise<void> {
    const weapon = pickBestWeapon(this.bot);
    
    if (weapon && typeof this.bot.equip === 'function') {
      try {
        logger.info(`BehaviorPvpAttack: equipping ${weapon.name}`);
        await this.bot.equip(weapon, 'hand');
      } catch (err: any) {
        logger.debug(`BehaviorPvpAttack: failed to equip weapon - ${err?.message || err}`);
      }
    }

    if (!this.active) {
      return;
    }

    try {
      this.bot.pvp!.attack(entity);
    } catch (err: any) {
      throw err;
    }
  }

  onStateExited(): void {
    logger.debug('BehaviorPvpAttack: state exited, cleaning up');
    this.cleanup();
  }

  isFinished(): boolean {
    return this.finished;
  }

  private configurePvp(): void {
    const pvp = this.bot.pvp!;

    const attackRange = this.config.attackRange ?? this.targets.attackRange ?? 3.0;
    const followRange = this.config.followRange ?? this.targets.followRange ?? 2.0;
    const viewDistance = this.config.viewDistance ?? this.targets.viewDistance ?? 48;

    pvp.attackRange = attackRange;
    pvp.followRange = followRange;
    pvp.viewDistance = viewDistance;

    logger.debug(`BehaviorPvpAttack: configured - attackRange=${attackRange}, followRange=${followRange}, viewDistance=${viewDistance}`);
  }

  private attachEventListeners(): void {
    this.stoppedAttackingHandler = () => {
      if (!this.active) return;
      
      logger.info('BehaviorPvpAttack: stoppedAttacking event received');
      
      if (this.config.onStopped) {
        const reason = this.attackCount > 0 ? 'completed' : 'target_lost';
        this.config.onStopped(reason);
      }
      
      this.finished = true;
    };

    this.attackedTargetHandler = () => {
      if (!this.active) return;
      
      this.attackCount++;
      logger.debug(`BehaviorPvpAttack: attack performed (count: ${this.attackCount})`);
      
      if (this.config.onAttackPerformed) {
        this.config.onAttackPerformed();
      }

      if (this.config.singleAttack) {
        logger.info('BehaviorPvpAttack: single attack completed, stopping');
        this.stopAttack();
        
        if (this.config.onStopped) {
          this.config.onStopped('completed');
        }
        
        this.finished = true;
      }
    };

    this.bot.on('stoppedAttacking', this.stoppedAttackingHandler);
    this.bot.on('attackedTarget', this.attackedTargetHandler);
  }

  private removeEventListeners(): void {
    if (this.stoppedAttackingHandler) {
      try {
        this.bot.off('stoppedAttacking', this.stoppedAttackingHandler);
      } catch {
        try {
          this.bot.removeListener('stoppedAttacking', this.stoppedAttackingHandler);
        } catch {}
      }
      this.stoppedAttackingHandler = null;
    }

    if (this.attackedTargetHandler) {
      try {
        this.bot.off('attackedTarget', this.attackedTargetHandler);
      } catch {
        try {
          this.bot.removeListener('attackedTarget', this.attackedTargetHandler);
        } catch {}
      }
      this.attackedTargetHandler = null;
    }
  }

  private stopAttack(): void {
    if (!this.bot.pvp) return;

    try {
      this.bot.pvp.stop();
    } catch (err: any) {
      logger.debug(`BehaviorPvpAttack: error stopping pvp - ${err?.message || err}`);
    }
  }

  private cleanup(): void {
    this.active = false;
    this.removeEventListeners();
    this.stopAttack();
  }

  forceStop(): void {
    if (!this.bot.pvp) return;

    try {
      this.bot.pvp.forceStop();
    } catch (err: any) {
      logger.debug(`BehaviorPvpAttack: error force stopping pvp - ${err?.message || err}`);
    }
    
    if (this.config.onStopped) {
      this.config.onStopped('manual');
    }
    
    this.cleanup();
    this.finished = true;
  }
}

export function createPvpAttackState(bot: Bot, targets: Targets, config: PvpAttackConfig = {}): BehaviorPvpAttack {
  return new BehaviorPvpAttack(bot, targets, config);
}

export default createPvpAttackState;

