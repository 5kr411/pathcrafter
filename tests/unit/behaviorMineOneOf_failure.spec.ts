import createMineOneOfState from '../../behaviors/behaviorMineOneOf';

jest.mock('../../behaviors/behaviorCollectBlock', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    onStateEntered: jest.fn(),
    onStateExited: jest.fn(),
    isFinished: jest.fn(() => true),
    getLastFailureReason: jest.fn(() => null)
  }))
}));

jest.mock('../../utils/findBlocks', () => ({
  findBlocksNonBlocking: jest.fn().mockResolvedValue([])
}));

jest.mock('../../utils/inventory', () => ({
  getItemCountInInventory: jest.fn(() => 0)
}));

describe('behaviorMineOneOf - stepSucceeded contract', () => {
  function makeBot() {
    return {
      version: '1.21.1',
      entity: { position: { x: 0, y: 0, z: 0 } },
      clearControlStates: jest.fn(),
      findBlocks: jest.fn(() => [])
    };
  }

  async function flushPromises() {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  }

  it('sets stepSucceeded=false with stepFailureReason when no viable candidate exists', async () => {
    const sm = createMineOneOfState(makeBot() as any, {
      candidates: [
        { blockName: 'oak_log', itemName: 'oak_log', amount: 1 },
        { blockName: 'birch_log', itemName: 'birch_log', amount: 1 }
      ],
      amount: 1
    });

    sm.onStateEntered();
    sm.update();              // enter -> prepare (kicks off async selection)
    await flushPromises();    // selectBestCandidateAsync resolves with no chosen
    sm.update();              // prepare -> exit (failure branch)

    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toMatch(/^no_viable_candidate:0\/1$/);

    sm.onStateExited();
  });

  it('leaves stepSucceeded undefined when goal already reached', async () => {
    // Inventory tracks deltas (current - initial). Baseline is captured on enter,
    // so simulate "already collected during execution" by returning 0 at baseline
    // then 1 on subsequent reads of oak_log.
    const inv = require('../../utils/inventory');
    let baselineCaptured = false;
    inv.getItemCountInInventory.mockImplementation((_: any, name: string) => {
      if (name !== 'oak_log') return 0;
      if (!baselineCaptured) {
        baselineCaptured = true;
        return 0;
      }
      return 1;
    });

    const sm = createMineOneOfState(makeBot() as any, {
      candidates: [{ blockName: 'oak_log', itemName: 'oak_log', amount: 1 }],
      amount: 1
    });

    sm.onStateEntered();
    sm.update();              // enter -> prepare (records baseline = 0)
    await flushPromises();    // async selection (irrelevant; goal already reached)
    sm.update();              // prepare -> exit (success branch: 1 >= 1)

    // The success path through tPrepareToExit's success branch must NOT mark failure
    expect(sm.stepSucceeded).not.toBe(false);

    sm.onStateExited();
  });
});
