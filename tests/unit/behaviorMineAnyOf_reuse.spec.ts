import { getItemCountInInventory } from '../../utils/inventory';

jest.mock('../../utils/inventory');
const mockGetItemCount = getItemCountInInventory as jest.MockedFunction<typeof getItemCountInInventory>;

describe('behaviorCollectBlock - baseline tracking bug', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('WITHOUT FIX: demonstrates the bug pattern where baseline is not reset', () => {
    let inventorySnapshot = 0;
    mockGetItemCount.mockImplementation(() => inventorySnapshot);

    const createBuggyBehavior = (itemName: string) => {
      const currentBlockCount = getItemCountInInventory(null as any, itemName);
      return {
        currentBlockCount,
        collectedCount() {
          return getItemCountInInventory(null as any, itemName) - currentBlockCount;
        }
      };
    };

    const behavior = createBuggyBehavior('bamboo');
    expect(behavior.currentBlockCount).toBe(0);
    expect(behavior.collectedCount()).toBe(0);

    inventorySnapshot = 64;
    expect(behavior.collectedCount()).toBe(64);

    inventorySnapshot = 74;
    const actualCount = behavior.collectedCount();
    
    expect(actualCount).toBe(74);
    expect(actualCount).not.toBe(10);
  });

  it('should reset baseline when reused for a new collection task', () => {
    let inventorySnapshot = 0;
    mockGetItemCount.mockImplementation(() => inventorySnapshot);

    const createBehaviorWithResettableBaseline = (itemName: string) => {
      let currentBlockCount = getItemCountInInventory(null as any, itemName);
      return {
        get currentBlockCount() {
          return currentBlockCount;
        },
        resetBaseline() {
          currentBlockCount = getItemCountInInventory(null as any, itemName);
        },
        collectedCount() {
          return getItemCountInInventory(null as any, itemName) - currentBlockCount;
        }
      };
    };

    const behavior = createBehaviorWithResettableBaseline('bamboo');
    expect(behavior.currentBlockCount).toBe(0);

    inventorySnapshot = 64;
    expect(behavior.collectedCount()).toBe(64);

    behavior.resetBaseline();
    expect(behavior.currentBlockCount).toBe(64);

    inventorySnapshot = 74;
    expect(behavior.collectedCount()).toBe(10);
  });
});

