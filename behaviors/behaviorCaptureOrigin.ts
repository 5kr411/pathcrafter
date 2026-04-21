import logger from '../utils/logger';

interface BotLike {
  entity?: { position: { x: number; y: number; z: number } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface Targets {
  originPosition?: { x: number; y: number; z: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

export class BehaviorCaptureOrigin {
  stateName = 'CaptureOrigin';
  active = false;
  private finished = false;

  constructor(private readonly bot: BotLike, private readonly targets: Targets) {}

  onStateEntered(): void {
    this.active = true;
    this.finished = false;
    const pos = this.bot?.entity?.position;
    if (pos) {
      this.targets.originPosition = { x: pos.x, y: pos.y, z: pos.z };
    } else {
      logger.debug('BehaviorCaptureOrigin: bot.entity missing; originPosition not written');
    }
    this.finished = true;
  }

  onStateExited(): void {
    this.active = false;
    this.finished = false;
  }

  isFinished(): boolean {
    return this.finished;
  }
}

export default BehaviorCaptureOrigin;
