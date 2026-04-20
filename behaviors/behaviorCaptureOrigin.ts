type Bot = any;
type Targets = { originPosition?: { x: number; y: number; z: number }; [key: string]: any };

export class BehaviorCaptureOrigin {
  stateName = 'CaptureOrigin';
  active = false;
  private finished = false;

  constructor(private readonly bot: Bot, private readonly targets: Targets) {}

  onStateEntered(): void {
    this.active = true;
    this.finished = false;
    const pos = this.bot?.entity?.position;
    if (pos) {
      this.targets.originPosition = { x: pos.x, y: pos.y, z: pos.z };
    }
    this.finished = true;
  }

  onStateExited(): void {
    this.active = false;
  }

  isFinished(): boolean {
    return this.finished;
  }
}

export default BehaviorCaptureOrigin;
