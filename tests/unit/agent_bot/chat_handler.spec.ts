import { AgentChatHandler } from '../../../bots/agent_bot/chat_handler';

function makeSession() {
  return { submitUserMessage: jest.fn() } as any;
}

function makeBot(overrides: any = {}) {
  return {
    username: 'agent_bot',
    players: {},
    ...overrides
  };
}

describe('AgentChatHandler', () => {
  it('routes @<botname> messages to the session with stripped command', () => {
    const session = makeSession();
    const bot = makeBot({
      players: { alice: { entity: { position: { x: 10.4, y: 64.0, z: -3.9 } } } }
    });
    const handler = new AgentChatHandler(bot, session);
    handler.handle('alice', '@agent_bot hello');
    expect(session.submitUserMessage).toHaveBeenCalledTimes(1);
    expect(session.submitUserMessage).toHaveBeenCalledWith('hello', {
      speaker: 'alice',
      position: { x: 10.4, y: 64.0, z: -3.9 }
    });
  });

  it('routes @all messages to the session', () => {
    const session = makeSession();
    const bot = makeBot({
      players: { bob: { entity: { position: { x: 1, y: 2, z: 3 } } } }
    });
    const handler = new AgentChatHandler(bot, session);
    handler.handle('bob', '@all collect wood');
    expect(session.submitUserMessage).toHaveBeenCalledWith('collect wood', {
      speaker: 'bob',
      position: { x: 1, y: 2, z: 3 }
    });
  });

  it('does NOT route messages mentioning a different bot', () => {
    const session = makeSession();
    const bot = makeBot();
    const handler = new AgentChatHandler(bot, session);
    handler.handle('alice', '@other_bot hi');
    expect(session.submitUserMessage).not.toHaveBeenCalled();
  });

  it('ignores self-messages', () => {
    const session = makeSession();
    const bot = makeBot();
    const handler = new AgentChatHandler(bot, session);
    handler.handle('agent_bot', '@agent_bot hi');
    expect(session.submitUserMessage).not.toHaveBeenCalled();
  });

  it('omits position metadata when speaker entity is unavailable', () => {
    const session = makeSession();
    const bot = makeBot({ players: {} });
    const handler = new AgentChatHandler(bot, session);
    handler.handle('carol', '@agent_bot hi');
    expect(session.submitUserMessage).toHaveBeenCalledWith('hi', {
      speaker: 'carol',
      position: undefined
    });
  });

  it('routes bare <botname> messages (no @ required)', () => {
    const session = makeSession();
    const bot = makeBot({
      players: { alice: { entity: { position: { x: 0, y: 64, z: 0 } } } }
    });
    const handler = new AgentChatHandler(bot, session);
    handler.handle('alice', 'agent_bot come here');
    expect(session.submitUserMessage).toHaveBeenCalledWith('come here', {
      speaker: 'alice',
      position: { x: 0, y: 64, z: 0 }
    });
  });

  it('does NOT route bare <other_bot> messages', () => {
    const session = makeSession();
    const bot = makeBot();
    const handler = new AgentChatHandler(bot, session);
    handler.handle('alice', 'other_bot hi');
    expect(session.submitUserMessage).not.toHaveBeenCalled();
  });

  it('requires @ for broadcast (bare "all" does not broadcast)', () => {
    const session = makeSession();
    const bot = makeBot();
    const handler = new AgentChatHandler(bot, session);
    handler.handle('alice', 'all collect wood');
    expect(session.submitUserMessage).not.toHaveBeenCalled();
  });
});
