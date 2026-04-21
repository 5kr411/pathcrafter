import * as fs from 'fs';
import * as path from 'path';

describe('collect-drop gate', () => {
  // Source-reading smoke tests: the pickup phase is deeply nested inside
  // NestedStateMachine factories composed of many StateTransition objects.
  // Driving the state machine to fire the pickup transition in a unit test
  // would require scaffolding the full world + entity graph. These textual
  // checks catch regressions where the gate is removed or the transition
  // stops awaiting it before it walks to the drop.

  const collectBlockPath = path.resolve(__dirname, '../../behaviors/behaviorCollectBlock.ts');
  const huntForFoodPath = path.resolve(__dirname, '../../behaviors/behaviorHuntForFood.ts');

  it('behaviorCollectBlock imports ensureInventoryRoom', () => {
    const src = fs.readFileSync(collectBlockPath, 'utf8');
    expect(src).toMatch(/import\s+\{\s*ensureInventoryRoom\s*\}\s+from\s+['"]\.\.\/utils\/inventoryGate['"]/);
    expect(src).toMatch(/ensureInventoryRoom\(/);
  });

  it('behaviorHuntForFood imports ensureInventoryRoom', () => {
    const src = fs.readFileSync(huntForFoodPath, 'utf8');
    expect(src).toMatch(/import\s+\{\s*ensureInventoryRoom\s*\}\s+from\s+['"]\.\.\/utils\/inventoryGate['"]/);
    expect(src).toMatch(/ensureInventoryRoom\(/);
  });

  it('behaviorCollectBlock gates the mineBlock -> findDrop transition (initial pickup)', () => {
    const src = fs.readFileSync(collectBlockPath, 'utf8');
    // Locate the specific transition object that kicks off pickup after a block is broken
    const transitionIdx = src.indexOf("name: 'BehaviorCollectBlock: mine block -> find drop'");
    expect(transitionIdx).toBeGreaterThan(0);
    // End of this StateTransition definition is the next "});" after transitionIdx
    const blockEndIdx = src.indexOf('});', transitionIdx);
    expect(blockEndIdx).toBeGreaterThan(transitionIdx);
    const transitionBlock = src.slice(transitionIdx, blockEndIdx);
    expect(transitionBlock).toMatch(/ensureInventoryRoom\(/);
  });

  it('behaviorCollectBlock does NOT gate the mid-pickup findDrop loop (go to drop -> find more drops)', () => {
    const src = fs.readFileSync(collectBlockPath, 'utf8');
    const transitionIdx = src.indexOf("name: 'BehaviorCollectBlock: go to drop -> find more drops'");
    expect(transitionIdx).toBeGreaterThan(0);
    const blockEndIdx = src.indexOf('});', transitionIdx);
    const transitionBlock = src.slice(transitionIdx, blockEndIdx);
    expect(transitionBlock).not.toMatch(/ensureInventoryRoom\(/);
  });

  it('behaviorHuntForFood gates the hunting -> findDrop transition (initial pickup after kill)', () => {
    const src = fs.readFileSync(huntForFoodPath, 'utf8');
    const transitionIdx = src.indexOf("name: 'HuntForFood: hunting -> find drop'");
    expect(transitionIdx).toBeGreaterThan(0);
    const blockEndIdx = src.indexOf('});', transitionIdx);
    expect(blockEndIdx).toBeGreaterThan(transitionIdx);
    const transitionBlock = src.slice(transitionIdx, blockEndIdx);
    expect(transitionBlock).toMatch(/ensureInventoryRoom\(/);
  });

  it('behaviorHuntForFood does NOT gate the mid-pickup findDrop loop (go to drop -> find drop)', () => {
    const src = fs.readFileSync(huntForFoodPath, 'utf8');
    const transitionIdx = src.indexOf("name: 'HuntForFood: go to drop -> find drop (collected, look for more)'");
    expect(transitionIdx).toBeGreaterThan(0);
    const blockEndIdx = src.indexOf('});', transitionIdx);
    const transitionBlock = src.slice(transitionIdx, blockEndIdx);
    expect(transitionBlock).not.toMatch(/ensureInventoryRoom\(/);
  });
});
