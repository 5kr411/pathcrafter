import logger from '../utils/logger';

const TOSS_DELAY_MS = 300;

interface BotLike {
  tossStack?: (item: any) => Promise<void>;
  toss?: (type: number, metadata: any, count: number) => Promise<void>;
  safeChat?: (msg: string) => void;
  [key: string]: any;
}

export interface DropCandidate {
  item: any;
  reason: string;
}

interface Targets {
  dropCandidates?: DropCandidate[];
  [key: string]: any;
}

export class BehaviorTossCandidates {
  public stateName = 'TossCandidates';
  public active = false;
  private finished = false;
  private success = false;
  private dropped = 0;

  constructor(private readonly bot: BotLike, private readonly targets: Targets) {}

  onStateEntered(): void {
    this.active = true;
    this.finished = false;
    this.success = false;
    this.dropped = 0;
    this.executeTossSequence();
  }

  onStateExited(): void {
    this.active = false;
  }

  isFinished(): boolean {
    return this.finished;
  }

  wasSuccessful(): boolean {
    return this.success;
  }

  droppedCount(): number {
    return this.dropped;
  }

  private async executeTossSequence(): Promise<void> {
    try {
      const candidates = this.targets?.dropCandidates ?? [];

      for (let i = 0; i < candidates.length; i++) {
        if (!this.active) break;
        const candidate = candidates[i];
        try {
          logger.debug(
            `TossCandidates: dropping ${candidate.item?.name} x${candidate.item?.count} (${candidate.reason})`
          );

          if (typeof this.bot.tossStack === 'function') {
            await this.bot.tossStack(candidate.item);
          } else if (typeof this.bot.toss === 'function') {
            await this.bot.toss(candidate.item.type, null, candidate.item.count);
          }
          this.dropped++;

          if (this.active && i < candidates.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, TOSS_DELAY_MS));
          }
        } catch (err: any) {
          logger.debug(
            `TossCandidates: failed to drop ${candidate.item?.name} - ${err?.message || err}`
          );
        }
      }

      this.success = this.dropped > 0;

      if (this.success && typeof this.bot.safeChat === 'function') {
        this.bot.safeChat(`dropped ${this.dropped} item(s) to free inventory space`);
      }
    } catch (err: any) {
      logger.info(`TossCandidates: sequence failed - ${err?.message || err}`);
    } finally {
      this.finished = true;
    }
  }
}

export default BehaviorTossCandidates;
