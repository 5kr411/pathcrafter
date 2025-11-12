import { parseTargetsFromMessage } from './chat_handler';
import { Target, Bot } from './config';
import { TargetExecutor } from './target_executor';

export class CommandHandler {
  private lastSequence: Target[] | null = null;

  constructor(
    private bot: Bot,
    private executor: TargetExecutor,
    private safeChat: (msg: string) => void
  ) {}

  handleChatMessage(username: string, message: string): void {
    if (username === this.bot.username) return;
    
    const m = message.trim();
    
    const targetInfo = this.extractTarget(m);
    if (!targetInfo.shouldRespond) {
      return;
    }
    
    const parts = targetInfo.command.split(/\s+/);
    const command = parts[0];

    if (command === 'collect') {
      this.handleCollectCommand(targetInfo.command);
    } else if (command === 'go') {
      this.handleGoCommand();
    } else if (command === 'stop') {
      this.handleStopCommand();
    }
  }

  private extractTarget(message: string): { shouldRespond: boolean; command: string } {
    const botName = this.bot.username.toLowerCase();
    const messageLower = message.toLowerCase().trim();
    
    if (!messageLower.startsWith('@')) {
      return { shouldRespond: false, command: message };
    }
    
    if (messageLower.startsWith('@all ')) {
      return {
        shouldRespond: true,
        command: message.substring(5).trim()
      };
    }
    
    if (messageLower.startsWith(`@${botName} `)) {
      return {
        shouldRespond: true,
        command: message.substring(botName.length + 2).trim()
      };
    }
    
    const collectorMatch = messageLower.match(/^@collector(\d+)\s+(.+)$/);
    if (collectorMatch && botName === `collector${collectorMatch[1]}`) {
      return {
        shouldRespond: true,
        command: collectorMatch[2].trim()
      };
    }
    
    return { shouldRespond: false, command: message };
  }

  private handleCollectCommand(message: string): void {
    const parsed = parseTargetsFromMessage(message);
    if (!parsed || parsed.length === 0) {
      this.safeChat('usage: collect <item> <count>[, <item> <count> ...]');
      return;
    }
    
    this.lastSequence = parsed.slice();
    this.executor.setTargets(parsed.slice());
    
    if (this.executor.isRunning()) {
      this.safeChat('already running, please wait');
      return;
    }
    
    this.executor.startNextTarget().catch(() => {});
  }

  private handleGoCommand(): void {
    if (!Array.isArray(this.lastSequence) || this.lastSequence.length === 0) {
      this.safeChat('no previous collect request');
      return;
    }
    
    this.executor.setTargets(this.lastSequence.slice());
    
    if (this.executor.isRunning()) {
      this.safeChat('already running, please wait');
      return;
    }
    
    this.executor.startNextTarget().catch(() => {});
  }

  private handleStopCommand(): void {
    this.executor.stop();
    this.lastSequence = null;
  }
}

