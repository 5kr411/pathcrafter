import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState } from './types';
import { ExecutionContext } from '../bots/collector/execution_context';
import createMineAnyOfState from '../behaviors/behaviorMineAnyOf';

interface Candidate {
  blockName: string;
  itemName: string;
  amount: number;
}

interface Targets {
  candidates: Candidate[];
  amount: number;
  executionContext?: ExecutionContext;
}

function canHandle(step: ActionStep | null | undefined): boolean {
  if (!step || step.action !== 'mine') return false;
  if (step.variantMode !== 'any_of') return false;
  
  if (step.what && step.what.variants && step.what.variants.length > 0) {
    return true;
  }
  
  return false;
}

function computeTargetsForMineAnyOf(step: ActionStep): Targets | null {
  if (!canHandle(step)) return null;
  const amount = Number(step.count || 1);
  
  let candidates: Candidate[] = [];
  
  if (step.what && step.what.variants && step.what.variants.length > 0) {
    candidates = step.what.variants.map((blockVariant, index) => {
      let itemName = blockVariant.value;
      
      if (step.targetItem && step.targetItem.variants) {
        if (step.targetItem.variants.length > index) {
          itemName = step.targetItem.variants[index].value;
        } else if (step.targetItem.variants.length > 0) {
          itemName = step.targetItem.variants[0].value;
        }
      }
      
      return {
        blockName: blockVariant.value,
        itemName,
        amount
      };
    });
  }
  
  if (candidates.length === 0) return null;
  return { candidates, amount };
}

function create(bot: Bot, step: ActionStep, executionContext?: ExecutionContext): BehaviorState | null {
  const t = computeTargetsForMineAnyOf(step);
  if (!t) return null;
  return createMineAnyOfState(bot, { candidates: t.candidates, amount: t.amount, executionContext });
}

export { canHandle, computeTargetsForMineAnyOf, create };
export default { canHandle, computeTargetsForMineAnyOf, create };

