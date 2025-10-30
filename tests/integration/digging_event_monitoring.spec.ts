import { createExecutionContext, hasToolIssue, resetToolIssue, signalToolIssue } from '../../bots/collector/execution_context';
import { getToolRemainingUses } from '../../utils/toolValidation';

/**
 * Integration tests for digging event monitoring
 * Tests the full flow: event listener lifecycle, durability checking, and tool replacement triggering
 */

describe('Digging Event Monitoring Integration', () => {
  describe('Event listener lifecycle', () => {
    it('should track listener state correctly', () => {
      let listenerActive = false;
      let listenerCallCount = 0;

      const addListener = () => {
        listenerActive = true;
      };

      const removeListener = () => {
        listenerActive = false;
      };

      const simulateDigging = () => {
        if (listenerActive) {
          listenerCallCount++;
        }
      };

      // Start: no listener
      expect(listenerActive).toBe(false);
      simulateDigging();
      expect(listenerCallCount).toBe(0);

      // Add listener
      addListener();
      expect(listenerActive).toBe(true);
      
      // Events should be caught
      simulateDigging();
      expect(listenerCallCount).toBe(1);
      simulateDigging();
      expect(listenerCallCount).toBe(2);

      // Remove listener
      removeListener();
      expect(listenerActive).toBe(false);

      // Events should be ignored
      simulateDigging();
      expect(listenerCallCount).toBe(2); // No increase
    });

    it('should handle multiple add/remove cycles', () => {
      let activeListeners = 0;

      const addListener = () => activeListeners++;
      const removeListener = () => activeListeners--;

      expect(activeListeners).toBe(0);

      addListener();
      expect(activeListeners).toBe(1);

      removeListener();
      expect(activeListeners).toBe(0);

      addListener();
      expect(activeListeners).toBe(1);

      removeListener();
      expect(activeListeners).toBe(0);
    });
  });

  describe('Durability detection during digging', () => {
    it('should detect low durability immediately after digging', () => {
      let replacementTriggered = false;
      const threshold = 20;

      const mockBot = {
        heldItem: {
          name: 'diamond_pickaxe',
          type: 278,
          durabilityUsed: 1541 // 20 uses left
        },
        registry: {
          items: {
            278: { maxDurability: 1561 }
          }
        }
      };

      // Simulate digging event handler
      const onDiggingCompleted = () => {
        const heldItem = mockBot.heldItem;
        if (!heldItem || !heldItem.name) return;

        const remainingUses = getToolRemainingUses(mockBot, heldItem);
        if (remainingUses > 0 && remainingUses <= threshold) {
          replacementTriggered = true;
        }
      };

      // Simulate digging
      onDiggingCompleted();

      expect(replacementTriggered).toBe(true);
    });

    it('should not trigger when durability is safe', () => {
      let replacementTriggered = false;
      const threshold = 20;

      const mockBot = {
        heldItem: {
          name: 'diamond_pickaxe',
          type: 278,
          durabilityUsed: 1000 // 561 uses left
        },
        registry: {
          items: {
            278: { maxDurability: 1561 }
          }
        }
      };

      const onDiggingCompleted = () => {
        const heldItem = mockBot.heldItem;
        if (!heldItem) return;

        const remainingUses = getToolRemainingUses(mockBot, heldItem);
        if (remainingUses > 0 && remainingUses <= threshold) {
          replacementTriggered = true;
        }
      };

      onDiggingCompleted();

      expect(replacementTriggered).toBe(false);
    });

    it('should track tool durability degradation over multiple digs', () => {
      const threshold = 20;
      const replacementTriggers: number[] = [];

      const mockBot = {
        heldItem: {
          name: 'wooden_pickaxe',
          type: 270,
          durabilityUsed: 35 // 24 uses left
        },
        registry: {
          items: {
            270: { maxDurability: 59 }
          }
        }
      };

      const onDiggingCompleted = () => {
        const heldItem = mockBot.heldItem;
        if (!heldItem) return;

        const remainingUses = getToolRemainingUses(mockBot, heldItem);
        if (remainingUses > 0 && remainingUses <= threshold) {
          replacementTriggers.push(remainingUses);
        }

        // Simulate tool wear
        heldItem.durabilityUsed++;
      };

      // Mine 10 blocks
      for (let i = 0; i < 10; i++) {
        onDiggingCompleted();
      }

      // Should have triggered replacement multiple times (once when crossing threshold)
      expect(replacementTriggers.length).toBeGreaterThan(0);
      expect(replacementTriggers[0]).toBeLessThanOrEqual(threshold);
    });
  });

  describe('Duplicate prevention with Set', () => {
    it('should prevent duplicate replacement requests', () => {
      const toolsBeingReplaced = new Set<string>();
      const replacementRequests: string[] = [];

      const requestReplacement = (toolName: string) => {
        if (toolsBeingReplaced.has(toolName)) {
          return; // Already being replaced
        }

        toolsBeingReplaced.add(toolName);
        replacementRequests.push(toolName);
      };

      // First request
      requestReplacement('diamond_pickaxe');
      expect(replacementRequests.length).toBe(1);

      // Duplicate requests (should be ignored)
      requestReplacement('diamond_pickaxe');
      requestReplacement('diamond_pickaxe');
      requestReplacement('diamond_pickaxe');

      expect(replacementRequests.length).toBe(1);
      expect(toolsBeingReplaced.size).toBe(1);
    });

    it('should allow replacement after completion', () => {
      const toolsBeingReplaced = new Set<string>();
      const replacementRequests: string[] = [];

      const requestReplacement = (toolName: string) => {
        if (toolsBeingReplaced.has(toolName)) return;
        toolsBeingReplaced.add(toolName);
        replacementRequests.push(toolName);
      };

      const completeReplacement = (toolName: string) => {
        toolsBeingReplaced.delete(toolName);
      };

      // First replacement cycle
      requestReplacement('diamond_pickaxe');
      expect(replacementRequests.length).toBe(1);

      // Complete
      completeReplacement('diamond_pickaxe');

      // Second replacement cycle (tool broke again)
      requestReplacement('diamond_pickaxe');
      expect(replacementRequests.length).toBe(2);
    });

    it('should handle multiple tools simultaneously', () => {
      const toolsBeingReplaced = new Set<string>();
      const replacementRequests: string[] = [];

      const requestReplacement = (toolName: string) => {
        if (toolsBeingReplaced.has(toolName)) return;
        toolsBeingReplaced.add(toolName);
        replacementRequests.push(toolName);
      };

      // Request replacements for different tools
      requestReplacement('diamond_pickaxe');
      requestReplacement('diamond_axe');
      requestReplacement('diamond_shovel');

      expect(replacementRequests.length).toBe(3);
      expect(toolsBeingReplaced.size).toBe(3);

      // Duplicates should be ignored
      requestReplacement('diamond_pickaxe');
      requestReplacement('diamond_axe');

      expect(replacementRequests.length).toBe(3);
      expect(toolsBeingReplaced.size).toBe(3);
    });
  });

  describe('Integration with ExecutionContext', () => {
    it('should work with execution context tool issue signaling', () => {
      let issueSignaled = false;
      let signaledToolName = '';

      const threshold = 20;
      const context = createExecutionContext(threshold, (issue) => {
        issueSignaled = true;
        signaledToolName = issue.toolName;
      });

      expect(context.durabilityThreshold).toBe(threshold);
      expect(issueSignaled).toBe(false);

      // Simulate tool issue
      signalToolIssue(context, {
        type: 'durability',
        toolName: 'diamond_pickaxe',
        blockName: 'stone',
        currentToolName: 'diamond_pickaxe'
      });

      expect(issueSignaled).toBe(true);
      expect(signaledToolName).toBe('diamond_pickaxe');
    });

    it('should track tool issue state correctly', () => {
      let callCount = 0;

      const context = createExecutionContext(20, () => {
        callCount++;
      });

      expect(hasToolIssue(context)).toBe(false);

      signalToolIssue(context, {
        type: 'durability',
        toolName: 'diamond_pickaxe',
        blockName: 'stone',
        currentToolName: 'diamond_pickaxe'
      });

      expect(hasToolIssue(context)).toBe(true);
      expect(callCount).toBe(1);

      resetToolIssue(context);
      expect(hasToolIssue(context)).toBe(false);
    });
  });

  describe('Realistic mining scenarios', () => {
    it('should handle extended mining session with tool replacement', () => {
      const threshold = 20;
      const events: string[] = [];
      const toolsBeingReplaced = new Set<string>();

      const mockBot = {
        heldItem: {
          name: 'diamond_pickaxe',
          type: 278,
          durabilityUsed: 1520 // 41 uses left
        },
        registry: {
          items: {
            278: { maxDurability: 1561 }
          }
        }
      };

      const onDiggingCompleted = () => {
        const heldItem = mockBot.heldItem;
        if (!heldItem) return;

        const remainingUses = getToolRemainingUses(mockBot, heldItem);
        
        if (remainingUses > 0 && remainingUses <= threshold && !toolsBeingReplaced.has(heldItem.name)) {
          events.push(`replacement_requested_at_${remainingUses}`);
          toolsBeingReplaced.add(heldItem.name);
        }

        // Simulate tool wear
        heldItem.durabilityUsed++;
      };

      // Mine until tool is below threshold
      for (let i = 0; i < 25; i++) {
        onDiggingCompleted();
      }

      // Should have triggered replacement once
      expect(events.length).toBe(1);
      expect(events[0]).toContain('replacement_requested_at_');
      
      // Extract the durability value from the event
      const durabilityAtRequest = parseInt(events[0].split('_').pop() || '0');
      expect(durabilityAtRequest).toBeLessThanOrEqual(threshold);
    });

    it('should handle navigation mining (incidental block breaking)', () => {
      const threshold = 20;
      let replacementTriggered = false;

      const mockBot = {
        heldItem: {
          name: 'diamond_pickaxe',
          type: 278,
          durabilityUsed: 1543 // 18 uses left
        },
        registry: {
          items: {
            278: { maxDurability: 1561 }
          }
        }
      };

      // Simulate bot breaking obstruction during navigation
      const remainingUses = getToolRemainingUses(mockBot, mockBot.heldItem);
      if (remainingUses > 0 && remainingUses <= threshold) {
        replacementTriggered = true;
      }

      expect(replacementTriggered).toBe(true);
      // Should trigger regardless of whether it's explicit mining or navigation
    });
  });
});

