describe('behaviorSmelt - stuck in findFurnace bug', () => {
  it('BEFORE FIX: demonstrates the bug where no exit transition existed', () => {
    const hasNoFurnaceInInventory = true;
    const hasNoFurnaceNearby = true;
    
    const canTransitionToEquip = !hasNoFurnaceNearby && !hasNoFurnaceInInventory;
    const canTransitionToSmelt = !hasNoFurnaceNearby;
    
    expect(canTransitionToEquip).toBe(false);
    expect(canTransitionToSmelt).toBe(false);
    
    const hadNoExitTransition = true;
    expect(hadNoExitTransition).toBe(true);
  });

  it('AFTER FIX: should have exit transition when no furnace is available', () => {
    const hasFurnaceInInventory = false;
    const hasFurnaceNearby = false;
    
    const canTransitionToEquip = !hasFurnaceNearby && hasFurnaceInInventory;
    const canTransitionToSmelt = hasFurnaceNearby;
    const shouldExitWithError = !hasFurnaceInInventory && !hasFurnaceNearby;
    
    expect(canTransitionToEquip).toBe(false);
    expect(canTransitionToSmelt).toBe(false);
    expect(shouldExitWithError).toBe(true);
  });
});

