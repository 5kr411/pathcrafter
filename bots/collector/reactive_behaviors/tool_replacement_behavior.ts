import { ReactiveBehavior, Bot } from './types';
import { ToolReplacementExecutor } from '../tool_replacement_executor';

export interface ToolReplacementBehaviorDeps {
  executor: ToolReplacementExecutor;
  toolsBeingReplaced: Set<string>;
  durabilityThreshold: number;
}

export function createToolReplacementBehavior(_deps: ToolReplacementBehaviorDeps): ReactiveBehavior {
  return {
    priority: 70,
    name: 'tool_replacement',
    shouldActivate: (_bot: Bot): boolean => false,
    createState: async (_bot: Bot) => null
  };
}
