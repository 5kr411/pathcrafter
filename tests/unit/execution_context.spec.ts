import {
  createExecutionContext,
  signalToolIssue,
  resetToolIssue,
  hasToolIssue
} from '../../bots/collector/execution_context';

describe('ExecutionContext', () => {
  describe('createExecutionContext', () => {
    it('should create context with default values', () => {
      const context = createExecutionContext(5);
      
      expect(context.durabilityThreshold).toBe(5);
      expect(context.toolIssueDetected).toBe(false);
      expect(context.toolIssue).toBeNull();
      expect(context.onToolIssue).toBeNull();
    });

    it('should create context with callback', () => {
      const callback = jest.fn();
      const context = createExecutionContext(10, callback);
      
      expect(context.durabilityThreshold).toBe(10);
      expect(context.onToolIssue).toBe(callback);
    });
  });

  describe('signalToolIssue', () => {
    it('should signal durability issue', () => {
      const callback = jest.fn();
      const context = createExecutionContext(5, callback);
      
      const issue = {
        type: 'durability' as const,
        toolName: 'wooden_pickaxe',
        blockName: 'stone'
      };
      
      signalToolIssue(context, issue);
      
      expect(context.toolIssueDetected).toBe(true);
      expect(context.toolIssue).toEqual(issue);
      expect(callback).toHaveBeenCalledWith(issue);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should signal requirement issue', () => {
      const callback = jest.fn();
      const context = createExecutionContext(5, callback);
      
      const issue = {
        type: 'requirement' as const,
        toolName: 'iron_pickaxe',
        blockName: 'diamond_ore',
        currentToolName: 'stone_pickaxe'
      };
      
      signalToolIssue(context, issue);
      
      expect(context.toolIssueDetected).toBe(true);
      expect(context.toolIssue).toEqual(issue);
      expect(callback).toHaveBeenCalledWith(issue);
    });

    it('should not signal twice for the same context', () => {
      const callback = jest.fn();
      const context = createExecutionContext(5, callback);
      
      const issue1 = {
        type: 'durability' as const,
        toolName: 'wooden_pickaxe',
        blockName: 'stone'
      };
      
      const issue2 = {
        type: 'requirement' as const,
        toolName: 'iron_pickaxe',
        blockName: 'diamond_ore'
      };
      
      signalToolIssue(context, issue1);
      signalToolIssue(context, issue2);
      
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(issue1);
      expect(context.toolIssue).toEqual(issue1);
    });

    it('should handle missing callback gracefully', () => {
      const context = createExecutionContext(5);
      
      const issue = {
        type: 'durability' as const,
        toolName: 'wooden_pickaxe',
        blockName: 'stone'
      };
      
      expect(() => signalToolIssue(context, issue)).not.toThrow();
      expect(context.toolIssueDetected).toBe(true);
    });

    it('should handle callback errors gracefully', () => {
      const callback = jest.fn(() => {
        throw new Error('Callback error');
      });
      const context = createExecutionContext(5, callback);
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const issue = {
        type: 'durability' as const,
        toolName: 'wooden_pickaxe',
        blockName: 'stone'
      };
      
      expect(() => signalToolIssue(context, issue)).not.toThrow();
      expect(context.toolIssueDetected).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('resetToolIssue', () => {
    it('should reset tool issue state', () => {
      const callback = jest.fn();
      const context = createExecutionContext(5, callback);
      
      const issue = {
        type: 'durability' as const,
        toolName: 'wooden_pickaxe',
        blockName: 'stone'
      };
      
      signalToolIssue(context, issue);
      expect(context.toolIssueDetected).toBe(true);
      
      resetToolIssue(context);
      expect(context.toolIssueDetected).toBe(false);
      expect(context.toolIssue).toBeNull();
    });

    it('should allow signaling after reset', () => {
      const callback = jest.fn();
      const context = createExecutionContext(5, callback);
      
      const issue1 = {
        type: 'durability' as const,
        toolName: 'wooden_pickaxe',
        blockName: 'stone'
      };
      
      signalToolIssue(context, issue1);
      resetToolIssue(context);
      
      const issue2 = {
        type: 'requirement' as const,
        toolName: 'iron_pickaxe',
        blockName: 'diamond_ore'
      };
      
      signalToolIssue(context, issue2);
      
      expect(context.toolIssueDetected).toBe(true);
      expect(context.toolIssue).toEqual(issue2);
      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  describe('hasToolIssue', () => {
    it('should return false initially', () => {
      const context = createExecutionContext(5);
      expect(hasToolIssue(context)).toBe(false);
    });

    it('should return true after signaling', () => {
      const context = createExecutionContext(5);
      
      signalToolIssue(context, {
        type: 'durability',
        toolName: 'wooden_pickaxe',
        blockName: 'stone'
      });
      
      expect(hasToolIssue(context)).toBe(true);
    });

    it('should return false after reset', () => {
      const context = createExecutionContext(5);
      
      signalToolIssue(context, {
        type: 'durability',
        toolName: 'wooden_pickaxe',
        blockName: 'stone'
      });
      
      resetToolIssue(context);
      expect(hasToolIssue(context)).toBe(false);
    });
  });
});

