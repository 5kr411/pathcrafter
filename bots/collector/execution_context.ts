export interface ToolIssue {
  type: 'durability' | 'requirement';
  toolName: string;
  blockName?: string;
  currentToolName?: string;
}

export interface ExecutionContext {
  toolIssueDetected: boolean;
  toolIssue: ToolIssue | null;
  onToolIssue: ((issue: ToolIssue) => void) | null;
  durabilityThreshold: number;
  toolsBeingReplaced?: Set<string>;
}

export function createExecutionContext(
  durabilityThreshold: number,
  onToolIssueCallback?: (issue: ToolIssue) => void,
  toolsBeingReplaced?: Set<string>
): ExecutionContext {
  return {
    toolIssueDetected: false,
    toolIssue: null,
    onToolIssue: onToolIssueCallback || null,
    durabilityThreshold,
    toolsBeingReplaced
  };
}

export function signalToolIssue(context: ExecutionContext, issue: ToolIssue): void {
  if (context.toolIssueDetected) {
    return;
  }

  // Check if this tool is already being replaced
  if (context.toolsBeingReplaced && context.toolsBeingReplaced.has(issue.toolName)) {
    return;
  }

  context.toolIssueDetected = true;
  context.toolIssue = issue;

  if (context.onToolIssue) {
    try {
      context.onToolIssue(issue);
    } catch (err: any) {
      console.error('Error in tool issue callback:', err);
    }
  }
}

export function resetToolIssue(context: ExecutionContext): void {
  context.toolIssueDetected = false;
  context.toolIssue = null;
}

export function hasToolIssue(context: ExecutionContext): boolean {
  return context.toolIssueDetected;
}

