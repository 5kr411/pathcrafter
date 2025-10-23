import { Item } from 'prismarine-item';
import { Block } from 'prismarine-block';

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

    const tool = this.getBestTool(block);
    
    if (tool != null) {
      this.bot.equip(tool, 'hand').then(() => {
        this.bot.dig(block).then(() => {
          this.isFinished = true;
        }).catch((err: any) => {
          console.log(err);
          this.isFinished = true;
        });
      }).catch((err: any) => {
        console.log(err);
        this.isFinished = true;
      });
    } else {
      this.bot.dig(block).then(() => {
        this.isFinished = true;
      }).catch((err: any) => {
        console.log(err);
        this.isFinished = true;
      });
    }
  }

  onStateExited(): void {
  }

  getBestTool(block: Block): Item | undefined {
    const items = this.bot.inventory.items();
    
    if (!block.harvestTools || Object.keys(block.harvestTools).length === 0) {
      return undefined;
    }

    let bestTool: Item | undefined = undefined;
    let bestDurability = -1;

    for (const toolIdStr in block.harvestTools) {
      const requiredToolId = parseInt(toolIdStr, 10);
      
      for (const item of items) {
        if (item.type === requiredToolId) {
          const itemData = this.bot.registry.items[item.type];
          const durability = itemData?.maxDurability || 0;
          
          if (durability > bestDurability) {
            bestTool = item;
            bestDurability = durability;
          }
        }
      }
    }

    if (bestTool && this.bot.heldItem != null && this.bot.heldItem.type === bestTool.type) {
      return undefined;
    }

    return bestTool;
  }
}

export default BehaviorMineBlock;

