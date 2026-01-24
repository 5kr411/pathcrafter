import logger from '../utils/logger';

interface Targets {
  position?: any;
  [key: string]: any;
}

export class BehaviorMineBlock {
  bot: any;
  targets: Targets;
  stateName: string = 'mineBlock';
  active: boolean = false;
  isFinished: boolean = false;

  constructor(bot: any, targets: Targets) {
    this.bot = bot;
    this.targets = targets;
  }

  onStateEntered(): void {
    this.isFinished = false;

    if (this.targets.position == null) {
      this.isFinished = true;
      return;
    }

    const block = this.bot.blockAt(this.targets.position);
    
    if (block == null || !this.bot.canDigBlock(block)) {
      this.isFinished = true;
      return;
    }

    this.bot.tool.equipForBlock(block, { requireHarvest: true })
      .then(() => {
        return this.bot.dig(block);
      })
      .then(() => {
        this.isFinished = true;
      })
      .catch((err: any) => {
        const errMsg = err?.message || String(err);
        logger.warn(`BehaviorMineBlock: ${errMsg}`);
        this.isFinished = true;
      });
  }

  onStateExited(): void {
  }
}

export default BehaviorMineBlock;
