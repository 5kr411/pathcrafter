import type { ActionStep, VariantGroup, ItemReference } from '../../action_tree/types';

/**
 * Checks whether a plan step's inventory dependencies are still satisfied.
 * Used to decide whether to resume or re-plan after a reactive behavior preempts execution.
 */
export function stepDependenciesSatisfied(
  step: ActionStep,
  inventory: Record<string, number>
): boolean {
  switch (step.action) {
    case 'require':
      return true;

    case 'mine':
    case 'hunt':
      return checkToolDep(step.tool, inventory);

    case 'craft':
      return checkIngredientsDep(step.ingredients, step.count, inventory);

    case 'smelt':
      return checkSmeltDep(step, inventory);

    default:
      return true;
  }
}

function checkToolDep(
  tool: VariantGroup<string> | undefined,
  inventory: Record<string, number>
): boolean {
  if (!tool || tool.variants.length === 0) return true;

  if (tool.mode === 'one_of') {
    const name = tool.variants[0].value;
    return (inventory[name] ?? 0) >= 1;
  }
  // any_of: any variant tool present
  return tool.variants.some(v => (inventory[v.value] ?? 0) >= 1);
}

function checkIngredientsDep(
  ingredients: VariantGroup<ItemReference[]> | undefined,
  count: number,
  inventory: Record<string, number>
): boolean {
  if (!ingredients || ingredients.variants.length === 0) return true;

  if (ingredients.mode === 'one_of') {
    return ingredientListSatisfied(ingredients.variants[0].value, count, inventory);
  }
  // any_of: any variant list fully satisfied
  return ingredients.variants.some(v =>
    ingredientListSatisfied(v.value, count, inventory)
  );
}

function ingredientListSatisfied(
  items: ItemReference[],
  stepCount: number,
  inventory: Record<string, number>
): boolean {
  return items.every(ref => {
    const needed = (ref.perCraftCount ?? 1) * stepCount;
    return (inventory[ref.item] ?? 0) >= needed;
  });
}

function checkSmeltDep(step: ActionStep, inventory: Record<string, number>): boolean {
  // Check input
  if (!step.input || step.input.variants.length === 0) return false;
  const inputOk = checkSmeltInput(step.input, step.count, inventory);
  if (!inputOk) return false;

  // Check fuel
  if (!step.fuel || step.fuel.variants.length === 0) return false;
  return checkToolDep(step.fuel, inventory); // fuel just needs >= 1
}

function checkSmeltInput(
  input: VariantGroup<ItemReference>,
  count: number,
  inventory: Record<string, number>
): boolean {
  if (input.mode === 'one_of') {
    const ref = input.variants[0].value;
    const needed = (ref.perSmelt ?? 1) * count;
    return (inventory[ref.item] ?? 0) >= needed;
  }
  return input.variants.some(v => {
    const needed = (v.value.perSmelt ?? 1) * count;
    return (inventory[v.value.item] ?? 0) >= needed;
  });
}
