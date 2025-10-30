import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState } from './types';
import { ExecutionContext } from '../bots/collector/execution_context';
import createMineOneOfState from '../behaviors/behaviorMineOneOf';

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
  if (step.variantMode !== 'one_of') return false;
  
  // Handle steps with variant information (from grouped nodes)
  if (step.what && step.what.variants && step.what.variants.length > 1) {
    return true;
  }
  
  // Handle legacy meta-based approach for backward compatibility
  const meta = (step as any).meta;
  return !!(meta && Array.isArray(meta.oneOfCandidates) && meta.oneOfCandidates.length > 0);
}

function computeTargetsForMineOneOf(step: ActionStep): Targets | null {
  if (!canHandle(step)) return null;
  const amount = Number(step.count || 1);
  
  let candidates: Candidate[] = [];
  
  // Handle variant-based approach (preferred)
  if (step.what && step.what.variants && step.what.variants.length > 1) {
    candidates = step.what.variants.map((blockVariant, index) => {
      let itemName = blockVariant.value; // Default to block name
      
      if (step.targetItem && step.targetItem.variants) {
        // If targetItem has variants, use the corresponding variant or first one
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
  } else {
    // Handle legacy meta-based approach for backward compatibility
    const itemName = step.targetItem ? 
      (step.targetItem.variants ? step.targetItem.variants[0].value : step.targetItem) : 
      (step.what.variants ? step.what.variants[0].value : step.what);
    const rawCandidates = (step as any).meta?.oneOfCandidates || [];
    candidates = rawCandidates
      .map((c: any) => {
        if (!c) return null;
        const blockName = c.blockName || c.what || c.block;
        if (!blockName) return null;
        return { blockName, itemName: itemName || blockName, amount };
      })
      .filter((c: any): c is Candidate => c !== null);
  }
  
  if (candidates.length === 0) return null;
  return { candidates, amount };
}

function create(bot: Bot, step: ActionStep, executionContext?: ExecutionContext): BehaviorState | null {
  const t = computeTargetsForMineOneOf(step);
  if (!t) return null;
  return createMineOneOfState(bot, { candidates: t.candidates, amount: t.amount, executionContext });
}

export { canHandle, computeTargetsForMineOneOf, create };
export default { canHandle, computeTargetsForMineOneOf, create };

