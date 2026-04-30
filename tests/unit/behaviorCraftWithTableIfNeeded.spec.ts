import createCraftWithTableIfNeeded from '../../behaviors/behaviorCraftWithTableIfNeeded';

jest.mock('../../behaviors/behaviorCraftWithTable', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {
    const inner: any = {
      isFinished: jest.fn(() => true),
      onStateEntered: jest.fn(),
      onStateExited: jest.fn()
    };
    inner.stepSucceeded = false;
    inner.stepFailureReason = 'place_table_failed:wooden_pickaxe';
    return inner;
  })
}));

jest.mock('../../utils/inventory', () => ({
  getItemCountInInventory: jest.fn(() => 0)
}));

describe('behaviorCraftWithTableIfNeeded - reason propagation', () => {
  it('propagates both stepSucceeded and stepFailureReason from inner machine', () => {
    const bot = { inventory: { items: () => [] } } as any;
    const sm = createCraftWithTableIfNeeded(bot, {
      itemName: 'wooden_pickaxe', amount: 1
    });

    sm.onStateEntered();
    sm.update();   // enter -> craftWithTable
    sm.update();   // craftWithTable -> exit (propagation transition)

    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toBe('place_table_failed:wooden_pickaxe');
    sm.onStateExited?.();
  });
});
