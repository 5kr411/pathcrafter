import { ReactiveBehavior, Bot } from './reactive_behaviors/types';

export class ReactiveBehaviorRegistry {
  private behaviors: ReactiveBehavior[] = [];

  register(behavior: ReactiveBehavior): void {
    this.behaviors.push(behavior);
    this.behaviors.sort((a, b) => b.priority - a.priority);
  }

  unregister(name: string): void {
    this.behaviors = this.behaviors.filter(b => b.name !== name);
  }

  async findActiveBehavior(bot: Bot): Promise<ReactiveBehavior | null> {
    for (const behavior of this.behaviors) {
      try {
        const shouldActivate = await behavior.shouldActivate(bot);
        if (shouldActivate) {
          return behavior;
        }
      } catch (err: any) {
        console.error(`Error checking behavior ${behavior.name}:`, err);
      }
    }
    return null;
  }

  getAll(): ReactiveBehavior[] {
    return [...this.behaviors];
  }

  clear(): void {
    this.behaviors = [];
  }
}

