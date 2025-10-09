import plan from './planner';
import { enumerateShortestPathsGenerator } from './path_generators/shortestPathsGenerator';
import { enumerateActionPaths } from './action_tree/enumerate';

async function debugEmptyPaths() {
  const { resolveMcData } = (plan as any)._internals;
  const mcData = resolveMcData('1.20.1');

  // Same setup as the failing test
  const inventory = { wooden_pickaxe: 1 };
  const snapshot = {
    version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
    blocks: { cobblestone: { count: 10, closestDistance: 5, averageDistance: 10 } },
    entities: {}
  };

  console.log('Building tree...');
  const tree = plan(mcData, 'cobblestone', 1, {
    log: false,
    inventory,
    worldSnapshot: snapshot,
    pruneWithWorld: true
  });

  console.log('Tree without world pruning...');
  const treeNoPrune = plan(mcData, 'cobblestone', 1, {
    log: false,
    inventory
  });

  // Find the wooden_pickaxe root node
  function findWoodenPickaxeRoot(node: any): any {
    if (node.action === 'root' && node.what?.variants?.[0]?.value === 'wooden_pickaxe') {
      return node;
    }
    if (node.children?.variants) {
      for (const child of node.children.variants) {
        const found = findWoodenPickaxeRoot(child.value);
        if (found) return found;
      }
    }
    return null;
  }

  const woodenPickaxeRoot = findWoodenPickaxeRoot(treeNoPrune);
  console.log('Wooden pickaxe root node:', woodenPickaxeRoot ? {
    action: woodenPickaxeRoot.action,
    count: woodenPickaxeRoot.count,
    childrenCount: woodenPickaxeRoot.children?.variants?.length || 0
  } : 'Not found');

  console.log('Generating paths from non-pruned tree with inventory...');
  const pathsNoPrune = Array.from(enumerateShortestPathsGenerator(treeNoPrune, { inventory })) as any[][];

  console.log(`Non-pruned tree with inventory generated ${pathsNoPrune.length} paths`);

  console.log('Generating paths from non-pruned tree without inventory...');
  const pathsNoPruneNoInv = Array.from(enumerateShortestPathsGenerator(treeNoPrune, {})) as any[][];

  console.log(`Non-pruned tree without inventory generated ${pathsNoPruneNoInv.length} paths`);

  if (pathsNoPruneNoInv.length > 0) {
    console.log('First path from non-pruned tree without inventory:', pathsNoPruneNoInv[0]);
  }

  console.log('Testing old enumerateActionPaths...');
  const oldPaths = enumerateActionPaths(treeNoPrune);
  console.log(`Old enumerate generated ${oldPaths.length} paths`);

  if (oldPaths.length > 0) {
    console.log('First path from old enumerate:', oldPaths[0]);
  }

  console.log('Tree built, generating paths...');
  const paths = Array.from(enumerateShortestPathsGenerator(tree, { inventory })) as any[][];

  console.log(`Generated ${paths.length} paths`);

  if (paths.length === 0) {
    console.log('No paths generated. Tree structure:');
    console.log(JSON.stringify(tree, null, 2));
  } else {
    console.log('First path:', paths[0]);
  }
}

debugEmptyPaths().catch(console.error);
