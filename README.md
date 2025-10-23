# PathCrafter

A Minecraft planning system that generates optimal action sequences for acquiring items. PathCrafter builds recipe trees, enumerates possible paths, and creates executable state machines for mineflayer bots.

## Quick Start

### Installation

```bash
npm install
```

### Basic Usage

```typescript
import plan from './planner';

const tree = plan('1.20.1', 'wooden_pickaxe', 1, {
  inventory: new Map([['oak_log', 5]]),
  log: true
});
```

### Running the Test Planner

```bash
npx ts-node scripts/testVariantPlanner.ts --item wooden_pickaxe --count 1 --tree --paths
```

## Key Concepts

### Variants

PathCrafter uses a variant-first system to handle alternative recipes and methods:

- **ONE_OF**: Choose exactly one option (e.g., oak_planks OR spruce_planks)
- **ANY_OF**: Any combination works (e.g., any wood type can satisfy the requirement)
- **ALL**: All children must be satisfied

Example from tree output:
```
oak_planks, spruce_planks, birch_planks, +8 more (want 4) [ONE OF]
```

### World Snapshots

World snapshots capture actual Minecraft world state for context-aware planning:

- Block counts and closest distances
- Entity locations and counts
- Distance-based filtering (radius threshold)

```typescript
const snapshot = captureRawWorldSnapshot(bot, { radius: 128 });
const tree = plan(mcData, 'iron_ingot', 3, {
  pruneWithWorld: true,
  worldSnapshot: snapshot
});
```

### Action Paths

Action paths are linear sequences of steps that achieve a goal:

```
Path (6 steps):
  1. mine crafting_table for [ANY OF] crafting_table (1x)
  2. mine [ONE OF] oak_log, oak_wood, stripped_oak_log, +37 more (2x)
  3. craft inventory (1x) → [ONE OF] 4 oak_planks, 4 spruce_planks, ...
  4. craft inventory (1x) → [ONE OF] 4 oak_planks, 4 spruce_planks, ...
  5. craft inventory (1x) → [ONE OF] 4 stick
  6. craft table (1x) → [ONE OF] 1 wooden_pickaxe
```

## Architecture

### Tree Generation

**Location**: `action_tree/build.ts`

Builds recipe trees using a variant-first approach:

1. Resolves minecraft-data for the target item
2. Explores all acquisition methods (craft, mine, smelt, hunt)
3. Recursively builds subtrees for ingredients
4. Groups similar items (wood families) to reduce branching
5. Tracks inventory to avoid crafting what you already have

```typescript
export function buildRecipeTree(
  ctx: any,
  itemName: string,
  targetCount: number,
  context: BuildContext
): RootNode
```

**Key Features**:
- Handles circular dependency detection
- Supports crafting table vs inventory crafting
- Tool requirement tracking (minimal tool preference)
- Depth limiting to prevent infinite recursion

### Tree Pruning

**Location**: `planner.ts`, `utils/worldBudget.ts`

Prunes impossible paths based on world availability:

1. Converts world snapshots to world budgets
2. Filters blocks/entities by distance threshold
3. Removes recipe branches for unavailable resources
4. Prunes early to reduce tree size

```typescript
function buildWorldBudgetFromSnapshot(snap: WorldSnapshot): WorldBudget {
  // Tracks available blocks, entities, and distances
  // Enforces distance thresholds for reachability
}
```

**World Budget Tracking**:
- `blocks`: Available block counts
- `entities`: Available entity counts
- `blocksInfo/entitiesInfo`: Distance metadata
- `distanceThreshold`: Maximum search radius
- `allowedBlocksWithinThreshold`: Reachable resources

### Path Generation

**Location**: `path_generators/`, `action_tree/enumerate.ts`

Generates multiple paths using different strategies:

1. **Action Paths Generator**: Enumerates by choosing action variants sequentially
2. **Shortest Paths Generator**: Prioritizes paths with fewest steps
3. **Lowest Weight Paths Generator**: Prioritizes paths by estimated cost/distance

```typescript
import { generateTopNPathsFromGenerators } from './path_generators/generateTopN';

const paths = await generateTopNPathsFromGenerators(tree, {
  inventory: inventoryMap,
  worldSnapshot: snapshot
}, perGenerator);
```

**Worker Orchestration**:
- Parallel path enumeration using worker pool
- Configurable paths per generator
- Deduplication and sorting by weight

### Path Optimization

**Location**: `path_optimizations/`

Optimizes generated paths to improve efficiency:

#### Hoist Mining
Moves mining steps earlier when safe:

```typescript
import { hoistMiningInPaths } from './path_optimizations/hoistMining';

// Before: [craft stick, mine log, craft pickaxe]
// After:  [mine log, craft stick, craft pickaxe]
```

#### Dedupe Persistent Items
Removes redundant crafting of reusable tools:

```typescript
import { dedupePersistentItemsInPaths } from './path_optimizations/dedupePersistentItems';

// Removes extra crafting_table crafts when one persists
```

### State Machine Build

**Location**: `behavior_generator/`

Converts action paths into executable mineflayer state machines:

```typescript
import { buildStateMachineForPath } from './behavior_generator/buildMachine';

const machine = buildStateMachineForPath(bot, path, (success) => {
  console.log('Path execution complete!', success);
});
```

**Action Handlers**:
- `mine.ts`: Block mining with tool requirements
- `mineOneOf.ts`: Choose one block type to mine
- `mineAnyOf.ts`: Mine any available block variant
- `craftInventory.ts`: Inventory crafting (2x2)
- `craftTable.ts`: Crafting table recipes (3x3)
- `craftVariant.ts`: Multi-variant crafting
- `smelt.ts`: Furnace smelting

Each handler:
1. Checks if it can handle the step (`canHandle()`)
2. Creates a behavior state (`create()`)
3. Uses mineflayer-statemachine for execution

### Additional Systems

#### Variant Constraint Manager
Tracks variant choices across the tree to maintain consistency:

```typescript
class VariantConstraintManager {
  addConstraint(itemName: string, constraint: VariantConstraint): void
  isVariantAllowed(itemName: string, variant: string): boolean
  getRequiredVariant(itemName: string): string | null
}
```

#### Worker Pool
Parallel processing for computationally expensive operations:

```typescript
// workers/enumerator_worker.ts - Path enumeration
// workers/planning_worker.ts - Tree building and planning
```

#### Bot Integration
Integration with mineflayer for in-game execution:

- `bots/path_runner.ts`: Executes action paths
- `bots/collector/`: Collection bot with snapshot capture
- `behaviors/`: Reusable behavior implementations

## Usage Examples

### Basic Planning

```typescript
import plan from './planner';

const tree = plan('1.20.1', 'iron_pickaxe', 1);
```

### With Inventory

```typescript
const inventory = new Map([
  ['oak_log', 10],
  ['stick', 4]
]);

const tree = plan('1.20.1', 'wooden_pickaxe', 1, {
  inventory,
  log: true
});
```

### With World Snapshots

```typescript
import { captureRawWorldSnapshot } from './utils/worldSnapshot';

const snapshot = captureRawWorldSnapshot(bot, {
  radius: 128,
  yHalf: 64
});

const tree = plan(bot.mcData, 'diamond_pickaxe', 1, {
  pruneWithWorld: true,
  worldSnapshot: snapshot,
  inventory: inventoryMap
});
```

### Path Generation and Optimization

```typescript
import { generateTopNAndFilter } from './path_filters';

const paths = await generateTopNAndFilter(
  mcData, 
  'iron_ingot', 
  5, 
  {
    inventory: inventoryMap,
    worldSnapshot: snapshot,
    perGenerator: 100
  }
);

// Paths are already optimized (hoisted mining, deduped persistent items)
```

### State Machine Execution

```typescript
import { buildStateMachineForPath } from './behavior_generator/buildMachine';

const machine = buildStateMachineForPath(bot, paths[0], (success) => {
  if (success) {
    console.log('Successfully acquired the item!');
  } else {
    console.log('Path execution failed');
  }
});

// Start the state machine
bot.on('idle', () => {
  machine.setState(machine.enter);
});
```

### Complete Example

```typescript
import plan from './planner';
import { generateTopNAndFilter } from './path_filters';
import { buildStateMachineForPath } from './behavior_generator/buildMachine';
import { captureRawWorldSnapshot } from './utils/worldSnapshot';

async function acquireItem(bot: any, itemName: string, count: number) {
  // 1. Capture world state
  const snapshot = captureRawWorldSnapshot(bot, { radius: 128 });
  
  // 2. Generate and filter paths
  const paths = await generateTopNAndFilter(
    bot.mcData,
    itemName,
    count,
    {
      pruneWithWorld: true,
      worldSnapshot: snapshot,
      perGenerator: 50
    }
  );
  
  if (paths.length === 0) {
    console.log('No valid paths found!');
    return;
  }
  
  // 3. Build and execute state machine
  const machine = buildStateMachineForPath(bot, paths[0], (success) => {
    console.log(`Acquisition ${success ? 'succeeded' : 'failed'}`);
  });
  
  machine.setState(machine.enter);
}
```

## Running the Collection Bot

The collection bot is an end-to-end mineflayer bot that can acquire items in a live Minecraft world.

### Starting the Bot

```bash
make bot-collect
```

The bot connects to `localhost:25565` by default. You can customize connection settings:

```bash
node dist/bots/collect_paths.js <host> <port> [username] [password]
```

### In-Game Commands

Once the bot spawns, use these commands in chat:

#### Collect Items

```
collect <item> <count>[, <item> <count>, ...]
```

Example:
```
collect crafting_table 5, stick 16, wooden_pickaxe 1, stone_pickaxe 1, iron_pickaxe 1, diamond_pickaxe 1, diamond_shovel 1, diamond_helmet 1, diamond_chestplate 1, diamond_leggings 1, diamond_boots 1, diamond_sword 1, diamond_axe 1
```

The bot will:
1. Capture a snapshot of the world
2. Generate optimal paths for each item
3. Execute the paths in sequence
4. Report progress in chat

#### Repeat Last Collection

```
go
```

Repeats the last `collect` command.

#### Stop Execution

```
stop
```

Stops the current collection sequence.

## Development

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Watch mode
npm run test:watch
```

### Building

```bash
npm run build          # Build once
npm run build:watch    # Watch mode
```

### Project Structure

```
pathcrafter/
├── action_tree/          # Recipe tree building and enumeration
│   ├── build.ts          # Main tree builder
│   ├── enumerate.ts      # Path enumeration
│   ├── logger.ts         # Tree visualization
│   ├── types.ts          # Core type definitions
│   └── builders/         # Specialized node builders
├── behavior_generator/   # Action → mineflayer behavior conversion
│   ├── buildMachine.ts   # State machine builder
│   ├── mine.ts           # Mining behaviors
│   ├── craftInventory.ts # Crafting behaviors
│   └── smelt.ts          # Smelting behaviors
├── behaviors/            # Reusable behavior implementations
├── bots/                 # Bot implementations and executors
│   ├── collector/        # Collection bot with planning
│   └── dumpWorld.ts      # World snapshot capture utility
├── path_generators/      # Path generation strategies
│   ├── actionPathsGenerator.ts
│   ├── shortestPathsGenerator.ts
│   └── lowestWeightPathsGenerator.ts
├── path_optimizations/   # Path optimization passes
│   ├── hoistMining.ts
│   └── dedupePersistentItems.ts
├── path_filters/         # Path filtering and validation
├── utils/                # Shared utilities
│   ├── worldSnapshot.ts  # World capture
│   ├── worldBudget.ts    # Resource tracking
│   └── items.ts          # Item utilities
├── workers/              # Worker pool for parallel processing
├── scripts/              # Utility scripts
│   └── testVariantPlanner.ts # CLI test tool
├── tests/                # Test suite
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
└── planner.ts            # Main entry point
```

### Tree Structure Example

```
└─ wooden_pickaxe (want 1) [ANY]
  └─ craft in table (1x) [ALL]
    ├─ 3 oak_planks + 2 stick, 3 spruce_planks + 2 stick, ... → 1 wooden_pickaxe
    ├─ crafting_table (want 1) [ONE OF]
    │   ├─ craft in inventory (1x) [ALL]
    │   │   ├─ 4 oak_planks, 4 spruce_planks, ... → 1 crafting_table
    │   │   └─ oak_planks, spruce_planks, ... (want 4) [ONE OF]
    │   │       ├─ craft in inventory (1x) [ALL]
    │   │       │   ├─ 1 oak_log, 1 oak_wood, ... → 4 oak_planks, ...
    │   │       │   └─ oak_log, oak_wood, ... (want 1) [ONE OF]
    │   │       │       └─ mine oak_log, oak_wood, ... (1x) [ONE OF]
    │   │       └─ mine oak_planks, ... (4x) [ONE OF]
    │   └─ mine crafting_table for crafting_table (1x)
    ├─ oak_planks, spruce_planks, ... (want 3) [ONE OF]
    └─ stick (want 2) [ONE OF]
```

## License

MIT

