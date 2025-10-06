/**
 * Type definitions for the action tree and recipe tree system
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
 * Common properties for all tree nodes
 */
interface BaseTreeNode {
  action: string;
  operator?: 'AND' | 'OR';
  what: string;
  count: number;
  children: TreeNode[];
}

/**
 * Root node of the recipe tree
 */
export interface RootNode extends BaseTreeNode {
  action: 'root';
  operator: 'OR';
}

/**
 * Craft action node
 */
export interface CraftNode extends BaseTreeNode {
  action: 'craft';
  operator: 'AND';
  what: 'table' | 'inventory';
  result: ItemReference;
  ingredients: ItemReference[];
  /**
   * When combineSimilarNodes is enabled, this contains all variants (e.g., oak_planks, spruce_planks)
   * Otherwise, it's undefined or contains just the primary result
   */
  resultVariants?: string[];
  ingredientVariants?: string[][];
  /**
   * Describes how variants relate to each other:
   * - 'one_of': Mutually exclusive options (pick one variant)
   * - 'any_of': Compatible alternatives (could use any/multiple)
   */
  variantMode?: 'one_of' | 'any_of';
}

/**
 * Mining action node with OR operator for multiple block sources
 */
export interface MineGroupNode extends BaseTreeNode {
  action: 'mine';
  operator: 'OR';
  targetItem?: string;
}

/**
 * Leaf mining node (actual mining action)
 */
export interface MineLeafNode {
  action: 'mine';
  what: string;
  targetItem?: string;
  tool?: string;
  count: number;
  operator?: never;
  children: [];
  /**
   * When combineSimilarNodes is enabled, this contains all block variants (e.g., oak_log, spruce_log)
   */
  whatVariants?: string[];
  targetItemVariants?: string[];
  /**
   * Describes how variants relate to each other:
   * - 'one_of': Mutually exclusive options (mine one type of block)
   * - 'any_of': Compatible alternatives (could mine any/multiple types)
   */
  variantMode?: 'one_of' | 'any_of';
}

/**
 * Smelting group node with OR operator for multiple input sources
 */
export interface SmeltGroupNode extends BaseTreeNode {
  action: 'smelt';
  operator: 'OR';
}

/**
 * Smelting action node with AND operator for dependencies
 */
export interface SmeltNode extends BaseTreeNode {
  action: 'smelt';
  operator: 'AND';
  what: 'furnace';
  input: ItemReference;
  result: ItemReference;
  fuel: string | null;
}

/**
 * Hunting group node with OR operator for multiple mob sources
 */
export interface HuntGroupNode extends BaseTreeNode {
  action: 'hunt';
  operator: 'OR';
}

/**
 * Leaf hunting node (actual hunting action)
 */
export interface HuntLeafNode {
  action: 'hunt';
  what: string;
  targetItem?: string;
  count: number;
  dropChance?: number;
  tool?: string;
  operator?: never;
  children: [];
}

/**
 * Require node for dependencies like tools
 */
export interface RequireNode extends BaseTreeNode {
  action: 'require';
  operator: 'AND';
  what: string;
}

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
  | RequireNode;

/**
 * Represents a single action step in an enumerated path
 */
export interface ActionStep {
  action: 'craft' | 'mine' | 'smelt' | 'hunt' | 'require';
  what: string;
  count: number;
  result?: ItemReference;
  ingredients?: ItemReference[];
  input?: ItemReference;
  fuel?: string | null;
  tool?: string;
  targetItem?: string;
  dropChance?: number;
  /**
   * When present, contains all alternative variants for mining (e.g., oak_log, spruce_log, birch_log)
   * The bot can choose which variant to mine at runtime based on world state
   */
  whatVariants?: string[];
  targetItemVariants?: string[];
  /**
   * When present, contains all alternative result variants for crafting
   * The bot can choose which variant to craft at runtime
   */
  resultVariants?: string[];
  /**
   * When present, contains ingredient variants corresponding to each result variant
   */
  ingredientVariants?: string[][];
  /**
   * Describes how variants relate to each other:
   * - 'one_of': Mutually exclusive options (pick one variant at runtime)
   * - 'any_of': Compatible alternatives (could use any/multiple)
   */
  variantMode?: 'one_of' | 'any_of';
}

/**
 * An enumerated path is a sequence of action steps
 */
export type ActionPath = ActionStep[];

/**
 * Context object for building recipe trees
 */
export interface BuildContext {
  inventory?: Record<string, number>;
  worldBudget?: WorldBudget;
  config?: any;
  avoidTool?: string;
  visited?: Set<string>;
  preferMinimalTools?: boolean;
  combineSimilarNodes?: boolean;
  /**
   * When combining is disabled, tracks the current family prefix (e.g., 'oak', 'spruce')
   * to ensure branches stay internally consistent
   */
  familyPrefix?: string;
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

