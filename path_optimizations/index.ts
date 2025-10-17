/**
 * Path optimization functions
 * 
 * These optimizations are applied after path enumeration to clean up
 * inefficiencies in the generated action sequences.
 */

export { hoistMiningInPath, hoistMiningInPaths } from './hoistMining';
export { dedupePersistentItemsInPath, dedupePersistentItemsInPaths } from './dedupePersistentItems';

