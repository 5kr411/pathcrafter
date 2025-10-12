/**
 * Type definitions for the action tree and recipe tree system
 * Refactored to use variant-first approach
 */

import type { WorldBudget } from '../utils/worldBudget';

/**
 * Represents metadata about an item
 */
export interface ItemMeta {
  // Reserved for future metadata
}

/**
 * Represents an ingredient or result with item name, count per craft, and metadata
 */
export interface ItemReference {
  item: string;
  perCraftCount?: number;
  perSmelt?: number;
  meta?: ItemMeta;
}

/**
 * Core variant types for variant-first system
 */
export interface Variant<T> {
  value: T;
  metadata?: {
    family?: string;        // "oak", "spruce", "birch"
    suffix?: string;        // "planks", "log", "stairs"
    availability?: boolean; // world-specific availability
    source?: string;        // where this variant came from
  };
}

export interface VariantGroup<T> {
  mode: 'one_of' | 'any_of';
  variants: Variant<T>[];
}

/**
 * Variant constraint tracking
 */
export interface VariantConstraint {
  type: 'one_of' | 'any_of';
  chosenVariant?: string;
  availableVariants: string[];
  constraintPath: string[];
}

export class VariantConstraintManager {
  private constraints = new Map<string, VariantConstraint>();
  
  addConstraint(itemName: string, constraint: VariantConstraint): void {
    this.constraints.set(itemName, constraint);
  }
  
  isVariantAllowed(itemName: string, variant: string): boolean {
    const constraint = this.constraints.get(itemName);
    if (!constraint) return true;
    
    if (constraint.type === 'one_of') {
      return constraint.chosenVariant === variant;
    } else {
      return constraint.availableVariants.includes(variant);
    }
  }
  
  getRequiredVariant(itemName: string): string | null {
    const constraint = this.constraints.get(itemName);
    return constraint?.type === 'one_of' ? constraint.chosenVariant || null : null;
  }
  
  getAllowedVariants(itemName: string): string[] {
    const constraint = this.constraints.get(itemName);
    return constraint?.availableVariants || [];
  }
  
  clone(): VariantConstraintManager {
    const cloned = new VariantConstraintManager();
    cloned.constraints = new Map(this.constraints);
    return cloned;
  }

  toJSON(): any {
    return {
      constraints: Array.from(this.constraints.entries())
    };
  }

  static fromJSON(data: any): VariantConstraintManager {
    const manager = new VariantConstraintManager();
    if (data?.constraints) {
      manager.constraints = new Map(data.constraints);
    }
    return manager;
  }
}

/**
 * Variant-first tree node system
 */

/**
 * Base tree node with variant-first approach
 */
export interface VariantTreeNode {
  action: string;
  operator?: 'AND' | 'OR';
  variantMode: 'one_of' | 'any_of';
  variants: VariantGroup<VariantTreeNode>;
  children: VariantGroup<VariantTreeNode>;
  context: BuildContext;
  
  what: VariantGroup<string>;
  count: number;
}

/**
 * Root node of the recipe tree
 */
export interface RootNode extends VariantTreeNode {
  action: 'root';
  operator: 'OR';
}

/**
 * Craft action node
 */
export interface CraftNode extends VariantTreeNode {
  action: 'craft';
  operator: 'AND';
  what: VariantGroup<'table' | 'inventory'>;
  result: VariantGroup<ItemReference>;
  ingredients: VariantGroup<ItemReference[]>;
}

/**
 * Mining action node with OR operator for multiple block sources
 */
export interface MineGroupNode extends VariantTreeNode {
  action: 'mine';
  operator: 'OR';
  targetItem: VariantGroup<string>;
}

/**
 * Leaf mining node (actual mining action)
 */
export interface MineLeafNode extends VariantTreeNode {
  action: 'mine';
  what: VariantGroup<string>;
  targetItem: VariantGroup<string>;
  tool?: VariantGroup<string>;
  operator?: never;
  children: VariantGroup<VariantTreeNode>;
}

/**
 * Smelting group node with OR operator for multiple input sources
 */
export interface SmeltGroupNode extends VariantTreeNode {
  action: 'smelt';
  operator: 'OR';
}

/**
 * Smelting action node with AND operator for dependencies
 */
export interface SmeltNode extends VariantTreeNode {
  action: 'smelt';
  operator: 'AND';
  what: VariantGroup<'furnace'>;
  input: VariantGroup<ItemReference>;
  result: VariantGroup<ItemReference>;
  fuel: VariantGroup<string>;
}

/**
 * Hunting group node with OR operator for multiple mob sources
 */
export interface HuntGroupNode extends VariantTreeNode {
  action: 'hunt';
  operator: 'OR';
}

/**
 * Leaf hunting node (actual hunting action)
 */
export interface HuntLeafNode extends VariantTreeNode {
  action: 'hunt';
  what: VariantGroup<string>;
  targetItem: VariantGroup<string>;
  dropChance?: VariantGroup<number>;
  tool?: VariantGroup<string>;
  operator?: never;
  children: VariantGroup<VariantTreeNode>;
}

/**
 * Require node for dependencies like tools
 */

/**
 * Union type of all possible tree nodes
 */
export type TreeNode =
  | RootNode
  | CraftNode
  | MineGroupNode
  | MineLeafNode
  | SmeltGroupNode
  | SmeltNode
  | HuntGroupNode
  | HuntLeafNode
;

/**
 * Represents a single action step in an enumerated path with variants
 */
export interface ActionStep {
  action: 'craft' | 'mine' | 'smelt' | 'hunt' | 'require';
  variantMode: 'one_of' | 'any_of';
  what: VariantGroup<string>;
  count: number;
  result?: VariantGroup<ItemReference>;
  ingredients?: VariantGroup<ItemReference[]>;
  input?: VariantGroup<ItemReference>;
  fuel?: VariantGroup<string>;
  tool?: VariantGroup<string>;
  targetItem?: VariantGroup<string>;
  dropChance?: VariantGroup<number>;
}

/**
 * An enumerated path is a sequence of action steps
 */
export type ActionPath = ActionStep[];

/**
 * Context object for building recipe trees with variant constraints
 */
export interface BuildContext {
  inventory: Map<string, number>;
  worldBudget?: WorldBudget;
  pruneWithWorld?: boolean;
  visited: Set<string>;
  depth: number;
  parentPath: string[];
  config: {
    preferMinimalTools: boolean;
    avoidTool?: string;
    maxDepth?: number;
  };
  variantConstraints: VariantConstraintManager;
  combineSimilarNodes?: boolean;
}

/**
 * World budget for tracking available resources
 */

/**
 * Minecraft data interface (simplified, only including what we use)
 */
export interface MinecraftData {
  version: string;
  items: Record<number, MinecraftItem>;
  itemsByName: Record<string, MinecraftItem>;
  blocks: Record<number, MinecraftBlock>;
  recipes: Record<number, MinecraftRecipe[]>;
  entityLoot?: Record<string, EntityLootTable>;
}

/**
 * Minecraft item
 */
export interface MinecraftItem {
  id: number;
  name: string;
  displayName: string;
  stackSize: number;
}

/**
 * Minecraft block
 */
export interface MinecraftBlock {
  id: number;
  name: string;
  displayName: string;
  hardness: number;
  drops?: number[];
  harvestTools?: Record<number, boolean>;
}

/**
 * Minecraft recipe
 */
export interface MinecraftRecipe {
  result: {
    id: number;
    count: number;
  };
  inShape?: (number | null)[][];
  ingredients?: number[];
}

/**
 * Entity loot table
 */
export interface EntityLootTable {
  entity: string;
  drops: Array<{
    item: string;
    dropChance?: number;
  }>;
}

/**
 * Block source for mining
 */
export interface BlockSource {
  block: string;
  tool: string;
}

/**
 * Mob source for hunting
 */
export interface MobSource {
  mob: string;
  dropChance?: number;
}

/**
 * Recipe scoring result (used internally for sorting recipes)
 */
export interface RecipeScore {
  recipe: MinecraftRecipe;
  missingTotal: number;
}

