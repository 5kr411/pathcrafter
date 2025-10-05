import createMineOneOfState from '../behaviors/behaviorMineOneOf';

interface Step {
  action?: string;
  count?: number;
  targetItem?: string;
  what?: string;
  meta?: {
    oneOfCandidates?: any[];
    [key: string]: any;
  };
  [key: string]: any;
}

interface Candidate {
  blockName: string;
  itemName: string;
  amount: number;
}

interface Targets {
  candidates: Candidate[];
  amount: number;
}

type Bot = any;

function canHandle(step: Step | null | undefined): boolean {
  if (!step || step.action !== 'mine') return false;
  const meta = step.meta;
  return !!(meta && Array.isArray(meta.oneOfCandidates) && meta.oneOfCandidates.length > 0);
}

function computeTargetsForMineOneOf(step: Step): Targets | null {
  if (!canHandle(step)) return null;
  const amount = Number(step.count || 1);
  const itemName = step.targetItem ? step.targetItem : step.what;
  const rawCandidates = step.meta?.oneOfCandidates || [];
  const candidates = rawCandidates
    .map((c: any) => {
      if (!c) return null;
      const blockName = c.blockName || c.what || c.block;
      if (!blockName) return null;
      return { blockName, itemName: itemName || blockName, amount };
    })
    .filter((c): c is Candidate => c !== null);
  if (candidates.length === 0) return null;
  return { candidates, amount };
}

function create(bot: Bot, step: Step): any {
  const t = computeTargetsForMineOneOf(step);
  if (!t) return null;
  return createMineOneOfState(bot, { candidates: t.candidates, amount: t.amount });
}

export { canHandle, computeTargetsForMineOneOf, create };
export default { canHandle, computeTargetsForMineOneOf, create };

