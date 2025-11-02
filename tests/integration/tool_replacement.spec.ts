import { createExecutionContext, signalToolIssue } from '../../bots/collector/execution_context';

describe('Tool Replacement Integration', () => {
  describe('Tool durability detection and replacement trigger', () => {
    it('should trigger onToolIssue callback when tool durability is low', (done) => {
      let callbackTriggered = false;
      let toolName = '';
      
      const executionContext = createExecutionContext(
        0.1,
        (issue) => {
          callbackTriggered = true;
          toolName = issue.toolName;
        }
      );
      
      signalToolIssue(executionContext, {
        type: 'durability',
        toolName: 'diamond_pickaxe',
        currentToolName: 'diamond_pickaxe'
      });
      
      setTimeout(() => {
        expect(callbackTriggered).toBe(true);
        expect(toolName).toBe('diamond_pickaxe');
        expect(executionContext.toolIssueDetected).toBe(true);
        done();
      }, 10);
    });

    it('should not trigger callback if tool is already being replaced', (done) => {
      let callbackCount = 0;
      const toolsBeingReplaced = new Set<string>(['diamond_pickaxe']);
      
      const executionContext = createExecutionContext(
        0.1,
        () => {
          callbackCount++;
        },
        toolsBeingReplaced
      );
      
      signalToolIssue(executionContext, {
        type: 'durability',
        toolName: 'diamond_pickaxe',
        currentToolName: 'diamond_pickaxe'
      });
      
      setTimeout(() => {
        expect(callbackCount).toBe(0);
        expect(executionContext.toolIssueDetected).toBe(false);
        done();
      }, 10);
    });

    it('should not trigger callback twice for same tool', (done) => {
      let callbackCount = 0;
      
      const executionContext = createExecutionContext(
        0.1,
        () => {
          callbackCount++;
        }
      );
      
      signalToolIssue(executionContext, {
        type: 'durability',
        toolName: 'diamond_pickaxe',
        currentToolName: 'diamond_pickaxe'
      });
      
      signalToolIssue(executionContext, {
        type: 'durability',
        toolName: 'diamond_pickaxe',
        currentToolName: 'diamond_pickaxe'
      });
      
      setTimeout(() => {
        expect(callbackCount).toBe(1);
        done();
      }, 10);
    });

    it('should handle deferred callback execution correctly', (done) => {
      const callOrder: string[] = [];
      
      const executionContext = createExecutionContext(
        0.1,
        () => {
          callOrder.push('callback-sync');
          setImmediate(() => {
            callOrder.push('callback-deferred');
          });
        }
      );
      
      callOrder.push('before-signal');
      signalToolIssue(executionContext, {
        type: 'durability',
        toolName: 'diamond_pickaxe',
        currentToolName: 'diamond_pickaxe'
      });
      callOrder.push('after-signal');
      
      setTimeout(() => {
        expect(callOrder).toEqual([
          'before-signal',
          'callback-sync',
          'after-signal',
          'callback-deferred'
        ]);
        done();
      }, 20);
    });
  });
});

