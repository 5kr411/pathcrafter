import { BehaviorTossCandidates } from '../../behaviors/behaviorTossCandidates';

function mkBot() {
  return {
    tossStack: jest.fn().mockResolvedValue(undefined),
    toss: jest.fn().mockResolvedValue(undefined),
    safeChat: jest.fn()
  };
}

describe('BehaviorTossCandidates', () => {
  it('finishes immediately with empty candidates list', async () => {
    const bot: any = mkBot();
    const targets: any = { dropCandidates: [] };
    const s = new BehaviorTossCandidates(bot, targets);
    s.onStateEntered();
    await new Promise(setImmediate);
    expect(s.isFinished()).toBe(true);
    expect(bot.tossStack).not.toHaveBeenCalled();
  });

  it('calls tossStack for each candidate', async () => {
    const bot: any = mkBot();
    const item1 = { name: 'cobblestone', count: 32, type: 4 };
    const item2 = { name: 'dirt', count: 16, type: 3 };
    const targets: any = { dropCandidates: [
      { item: item1, reason: 'excess_over_target' },
      { item: item2, reason: 'duplicate_stack' }
    ]};
    const s = new BehaviorTossCandidates(bot, targets);
    s.onStateEntered();
    await new Promise(r => setTimeout(r, 800));
    expect(bot.tossStack).toHaveBeenCalledWith(item1);
    expect(bot.tossStack).toHaveBeenCalledWith(item2);
    expect(s.isFinished()).toBe(true);
    expect(s.droppedCount()).toBe(2);
  });

  it('continues after a per-item toss error', async () => {
    const bot: any = mkBot();
    bot.tossStack = jest.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const targets: any = { dropCandidates: [
      { item: { name: 'a', count: 1, type: 1 }, reason: 'duplicate_stack' },
      { item: { name: 'b', count: 1, type: 2 }, reason: 'duplicate_stack' }
    ]};
    const s = new BehaviorTossCandidates(bot, targets);
    s.onStateEntered();
    await new Promise(r => setTimeout(r, 800));
    expect(bot.tossStack).toHaveBeenCalledTimes(2);
    expect(s.isFinished()).toBe(true);
    expect(s.droppedCount()).toBe(1);
  });

  it('falls back to bot.toss when tossStack is absent', async () => {
    const bot: any = { toss: jest.fn().mockResolvedValue(undefined), safeChat: jest.fn() };
    const item = { name: 'stone', count: 8, type: 5 };
    const targets: any = { dropCandidates: [{ item, reason: 'duplicate_stack' }] };
    const s = new BehaviorTossCandidates(bot, targets);
    s.onStateEntered();
    await new Promise(r => setTimeout(r, 400));
    expect(bot.toss).toHaveBeenCalledWith(item.type, null, item.count);
    expect(s.droppedCount()).toBe(1);
  });
});
