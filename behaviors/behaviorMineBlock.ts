import logger from '../utils/logger';

interface Targets {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  position?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

export class BehaviorMineBlock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  bot: any;
  targets: Targets;
  stateName: string = 'mineBlock';
  active: boolean = false;
  isFinished: boolean = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
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
