import type { AgentSession } from './agent_session';

export class AgentChatHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
  constructor(private readonly bot: any, private readonly session: AgentSession) {}

  handle(username: string, message: string): void {
    if (username === this.bot.username) return;
    const parsed = this.extractMention(message.trim());
    if (parsed === null) return;
    const speakerEntity = this.bot.players?.[username]?.entity;
    const position = speakerEntity?.position
      ? { x: speakerEntity.position.x, y: speakerEntity.position.y, z: speakerEntity.position.z }
      : undefined;
    this.session.submitUserMessage(parsed, { speaker: username, position });
  }

  private extractMention(msg: string): string | null {
    const name = String(this.bot.username ?? '').toLowerCase();
    const low = msg.toLowerCase();
    if (low.startsWith('@all ')) return msg.substring(5).trim();
    if (!name) return null;
    if (low.startsWith(`@${name} `)) return msg.substring(name.length + 2).trim();
    if (low.startsWith(`${name} `)) return msg.substring(name.length + 1).trim();
    return null;
  }
}
