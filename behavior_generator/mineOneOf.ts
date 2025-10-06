import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState } from './types';
import createMineOneOfState from '../behaviors/behaviorMineOneOf';

interface Candidate {
  blockName: string;
  itemName: string;
  amount: number;
}

interface Targets {
  candidates: Candidate[];
  amount: number;
}

function canHandle(step: ActionStep | null | undefined): boolean {
  if (!step || step.action !== 'mine') return false;
  
  // Handle steps with variant information (from grouped nodes)
  if (step.whatVariants && step.whatVariants.length > 1) {
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
  if (step.whatVariants && step.whatVariants.length > 1) {
    const targetItemVariants = step.targetItemVariants || step.whatVariants;
    candidates = step.whatVariants.map((blockName, index) => ({
      blockName,
      itemName: targetItemVariants[index] || blockName,
      amount
    }));
  } else {
    // Handle legacy meta-based approach for backward compatibility
    const itemName = step.targetItem ? step.targetItem : step.what;
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

function create(bot: Bot, step: ActionStep): BehaviorState | null {
  const t = computeTargetsForMineOneOf(step);
  if (!t) return null;
  return createMineOneOfState(bot, { candidates: t.candidates, amount: t.amount });
}

export { canHandle, computeTargetsForMineOneOf, create };
export default { canHandle, computeTargetsForMineOneOf, create };

