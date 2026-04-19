import { createToolReplacementBehavior } from '../../bots/collector/reactive_behaviors/tool_replacement_behavior';
import { setWorkstationPhaseProvider } from '../../utils/workstationLock';

const NAME_TO_ID: Record<string, number> = {
  iron_pickaxe: 256,
  wooden_pickaxe: 270,
  stone_pickaxe: 274,
  iron_axe: 258,
  iron_sword: 267,
  diamond_pickaxe: 278,
  shield: 999,
  bow: 261
};
function nameToId(name: string) { return NAME_TO_ID[name] ?? 1; }

function makeItem(name: string, durabilityUsed: number, maxDurability: number, count = 1) {
  return {
    name,
    type: nameToId(name),
    count,
    durabilityUsed,
    maxDurability
  };
}

function makeBot(items: any[] = []) {
  const registryItems: Record<number, any> = {};
  for (const it of items) {
    if (it && it.maxDurability) {
      registryItems[it.type] = { maxDurability: it.maxDurability };
    }
  }
  return {
    inventory: { items: () => items },
    registry: { items: registryItems },
    version: '1.21.11'
  } as any;
}

function makeExecutor() {
  return {
    executeReplacement: jest.fn(async () => true)
  } as any;
}

describe('tool_replacement_behavior', () => {
  describe('shouldActivate', () => {
    it('returns false when inventory is empty', async () => {
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const result = await behavior.shouldActivate(makeBot([]));
      expect(result).toBe(false);
    });

    it('returns true when the sole tool is below threshold', async () => {
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      // 237/250 used → 5.2% remaining
      const items = [makeItem('iron_pickaxe', 237, 250)];
      const result = await behavior.shouldActivate(makeBot(items));
      expect(result).toBe(true);
    });

    it('returns false when a spare of the same name is healthy', async () => {
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const items = [
        makeItem('iron_pickaxe', 237, 250), // 5% — low
        makeItem('iron_pickaxe', 50, 250)   // 80% — spare
      ];
      const result = await behavior.shouldActivate(makeBot(items));
      expect(result).toBe(false);
    });

    it('returns false when best tier is healthy but a lower tier is dying', async () => {
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const items = [
        makeItem('iron_pickaxe', 10, 250),   // 96% — healthy best
        makeItem('wooden_pickaxe', 58, 59)   // 1.7% — dying lower tier (ignored)
      ];
      const result = await behavior.shouldActivate(makeBot(items));
      expect(result).toBe(false);
    });

    it('returns false when best tier is dying but a lower tier is a usable fallback', async () => {
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const items = [
        makeItem('iron_pickaxe', 237, 250),   // 5% — dying best
        makeItem('wooden_pickaxe', 10, 59)    // 83% — healthy fallback
      ];
      const result = await behavior.shouldActivate(makeBot(items));
      expect(result).toBe(false);
    });

    it('triggers on the best-tier name when every tool in the group is dying', async () => {
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const items = [
        makeItem('iron_pickaxe', 237, 250),  // 5%
        makeItem('wooden_pickaxe', 56, 59)   // 5%
      ];
      const result = await behavior.shouldActivate(makeBot(items));
      expect(result).toBe(true);
    });

    it('returns false when the best tool is already in toolsBeingReplaced', async () => {
      const set = new Set<string>(['iron_pickaxe']);
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: set,
        durabilityThreshold: 0.1
      });
      const items = [makeItem('iron_pickaxe', 237, 250)];
      const result = await behavior.shouldActivate(makeBot(items));
      expect(result).toBe(false);
    });

    it('ignores shield entirely', async () => {
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const items = [makeItem('shield', 330, 336)]; // ~1.8% remaining
      const result = await behavior.shouldActivate(makeBot(items));
      expect(result).toBe(false);
    });

    it('triggers for tierless durable tools (bow)', async () => {
      const behavior = createToolReplacementBehavior({
        executor: makeExecutor(),
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const items = [makeItem('bow', 380, 384)]; // ~1% remaining
      const result = await behavior.shouldActivate(makeBot(items));
      expect(result).toBe(true);
    });

    describe('workstation lock', () => {
      afterEach(() => {
        setWorkstationPhaseProvider(null);
      });

      it('returns false while workstation is locked', async () => {
        setWorkstationPhaseProvider(() => true);
        const behavior = createToolReplacementBehavior({
          executor: makeExecutor(),
          toolsBeingReplaced: new Set<string>(),
          durabilityThreshold: 0.1
        });
        const items = [makeItem('iron_pickaxe', 237, 250)];
        const result = await behavior.shouldActivate(makeBot(items));
        expect(result).toBe(false);
      });
    });
  });

  describe('createState dispatch', () => {
    it('calls executor.executeReplacement with the target tool name', async () => {
      const executor = makeExecutor();
      const behavior = createToolReplacementBehavior({
        executor,
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const bot = makeBot([makeItem('iron_pickaxe', 237, 250)]);
      const activated = await behavior.shouldActivate(bot);
      expect(activated).toBe(true);

      const state: any = await behavior.createState(bot);
      expect(state).not.toBeNull();
      expect(state.stateMachine).toBeDefined();

      state.stateMachine.onStateEntered?.();
      // Run the scheduler-style update loop a few ticks to allow
      // mineflayer-statemachine transitions to fire.
      for (let i = 0; i < 3; i++) {
        state.stateMachine.update?.();
        await Promise.resolve();
      }
      expect(executor.executeReplacement).toHaveBeenCalledWith('iron_pickaxe');
    });

    it('finishes immediately after dispatching (fire-and-forget; does not await executor)', async () => {
      // Executor promise intentionally never resolves — the reactive behavior
      // must still finish promptly. Awaiting would deadlock the control stack
      // (reactive holds priority over tool; tool can only run once reactive
      // releases).
      const executor: any = {
        executeReplacement: jest.fn(() => new Promise<boolean>(() => { /* never resolves */ }))
      };
      const behavior = createToolReplacementBehavior({
        executor,
        toolsBeingReplaced: new Set<string>(),
        durabilityThreshold: 0.1
      });
      const bot = makeBot([makeItem('iron_pickaxe', 237, 250)]);
      await behavior.shouldActivate(bot);
      const state: any = await behavior.createState(bot);

      state.stateMachine.onStateEntered?.();
      for (let i = 0; i < 3; i++) {
        state.stateMachine.update?.();
        await Promise.resolve();
      }
      expect(executor.executeReplacement).toHaveBeenCalledWith('iron_pickaxe');
      expect(state.isFinished?.()).toBe(true);
      expect(state.wasSuccessful?.()).toBe(true);
    });
  });
});
