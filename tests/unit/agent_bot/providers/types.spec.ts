import type { LLMProvider, TurnParams, TurnResult } from '../../../../bots/agent_bot/providers/types';

const _stub: LLMProvider = {
  async runTurn(_p: TurnParams): Promise<TurnResult> {
    return { text: null, toolCalls: [], stopReason: 'end' };
  },
  label() { return 'stub'; }
};

test('LLMProvider interface compiles with a stub', () => {
  expect(typeof _stub.runTurn).toBe('function');
  expect(_stub.label()).toBe('stub');
});
