# Minecraft Bot Skipped Tests Investigation

## Current State
The test suite has a significant number of skipped tests that need investigation:
- **Total test files**: 60 (40 active, 20 skipped)
- **Total tests**: 317 (241 active, 76 skipped)
- **Test runtime**: ~17.4 seconds for active tests
- **Skipped test suites**: 20 files marked with `describe.skip()` or `test.skip()`

## Problem Statement

Skipped tests represent:
1. **Technical Debt**: Untested code paths and unverified behavior
2. **Regression Risk**: Changes may break functionality that was previously tested
3. **Documentation Gap**: Skipped tests may contain important requirements/edge cases
4. **Maintenance Burden**: Unclear why tests were skipped or if they're still relevant

## Goals

**Primary Objective**: Review all skipped tests and determine appropriate action for each.

**Outcomes**:
1. Re-enable tests that can be fixed or are still relevant
2. Update/refactor tests that need modernization
3. Remove tests that are obsolete or redundant
4. Document reasons for any remaining skipped tests

## Investigation Process

### Phase 1: Inventory and Categorization

For each skipped test/suite:
1. **Document location and skip reason** (if commented)
2. **Categorize** into one of these buckets:
   - **Broken**: Test logic is incorrect or incompatible with current code
   - **Slow**: Test was skipped due to performance (may be fixed by recent optimizations)
   - **Flaky**: Test has intermittent failures
   - **Incomplete**: Test is a work-in-progress
   - **Unimplemented**: Feature not yet implemented (especially state machine building)
   - **Obsolete**: Feature/behavior no longer exists or is tested elsewhere
   - **Unclear**: No obvious reason for skipping

### Phase 2: Analysis and Action Plan

For each category:

#### Broken Tests
**Action**: Fix or remove
- Check if underlying functionality still exists
- Update test assertions to match current behavior
- Fix API incompatibilities
- If core functionality changed significantly, consider rewriting

#### Slow Tests
**Action**: Optimize and re-enable
- Apply recent optimization techniques (caching, limited enumeration, beforeAll)
- If fundamentally slow, consider:
  - Moving to separate "slow test" suite
  - Reducing test scope (test representative sample, not exhaustive)
  - Mocking heavy dependencies

#### Flaky Tests
**Action**: Stabilize or remove
- Identify source of non-determinism (timing, race conditions, external dependencies)
- Add proper setup/teardown
- Use deterministic test data
- If can't be stabilized, document why and consider alternative testing approach

#### Incomplete Tests
**Action**: Complete or remove
- Check if feature is still being developed
- Complete test implementation if feature is done
- Remove if feature was abandoned

#### Unimplemented Tests
**Action**: Document and defer or remove
- Tests for planned but unimplemented features (e.g., state machine building)
- Check if feature is on roadmap
- If planned:
  - Keep skipped with clear TODO comment
  - Link to relevant issue/ticket if exists
  - Document what needs to be implemented first
- If not planned:
  - Remove test (don't keep tests for abandoned features)
  - Or convert to design document if valuable

#### Obsolete Tests
**Action**: Remove
- Verify feature no longer exists
- Check if behavior is tested elsewhere
- Clean up any test utilities used only by obsolete tests
- Document removal in commit message

#### Unclear Tests
**Action**: Investigate deeply
- Review git history to understand when/why skipped
- Check related issues or PRs
- Run test to see current behavior
- Consult team if needed

### Phase 3: Execution

**Priority Order**:
1. Quick wins - tests that can be re-enabled with minimal changes
2. Obsolete tests - clean up dead code
3. Broken tests - fix or modernize
4. Slow tests - optimize if possible
5. Flaky/Incomplete - requires more investigation

## Known Skipped Test Locations

Based on test output, the following files have skipped tests:

### Integration Tests (~13 skipped suites)
Likely in `tests/integration/` directory. Common patterns:
- World-related tests (may need real world snapshots)
- Complex integration scenarios
- End-to-end workflows
- **State machine building** - behavior generator tests for unimplemented features

### Unit Tests (~7 skipped suites)
Likely in `tests/unit/` directory. Common patterns:
- Edge cases
- Deprecated features
- Tests for optional functionality

### Known Unimplemented Features

**State Machine Building**: Some tests may be skipped because they test behavior generation or state machine building functionality that isn't fully implemented yet. Common areas:
- `behavior_generator/` tests - may have incomplete functionality
- `behaviors/` tests - behavior execution may not be complete
- `bots/` integration tests - bot behavior orchestration
- Specific action types or edge cases in state machines

**Action**: For these tests:
1. Verify the underlying functionality is truly unimplemented (not just the test)
2. Document what needs to be implemented for test to pass
3. Add TODO comments with clear requirements
4. Consider creating tracking issues for implementation
5. Keep tests as specification/documentation of intended behavior

## Specific Tests to Investigate

### From Earlier Analysis

### Potentially Unimplemented Features

Check `behavior_generator/` and `behaviors/` test directories for tests marked as skipped that may be waiting on:
- State machine construction logic
- Behavior execution framework
- Bot action coordination
- Specific behavior implementations (craft, mine, smelt, etc.)

**Investigation approach**:
```bash
# Find behavior-related skipped tests
grep -rn "describe\.skip\|test\.skip" tests/ --include="*behavior*.ts" -A 2

# Check for TODO comments near skipped tests
grep -rn "describe\.skip\|test\.skip" tests/ -B 2 -A 2 | grep -i "todo\|unimplemented\|not.*implemented"
```

### Other Known Skipped Tests

1. **`tests/unit/world_pruning.spec.ts`** - `describe.skip('unit: planner world-pruning')`
   - Reason: "generic wood disabled"
   - Action: Check if this is still relevant after variant/combining changes

2. **`tests/integration/wooden_pickaxe.spec.ts`** - `describe.skip('integration: wooden_pickaxe with inventory')`
   - May have been too slow previously
   - Action: Try re-enabling with new optimizations

3. **`tests/integration/world_drop_pruning_integration.spec.ts`** - `describe.skip('integration: world pruning respects block->drop mapping')`
   - May be testing deprecated behavior
   - Action: Verify if block->drop logic still exists

4. **`tests/unit/utils.spec.ts`** - Has `describe.skip('unit: crafting table dependency')`
   - May have been slow (enumerates all paths)
   - Action: Apply optimization techniques and re-enable

5. **`tests/integration/tie_break_distance_integration.spec.ts`** - `describe.skip('integration: Top-N tie-break prefers closer blocks')`
   - May require specific world snapshots
   - Some tests within suite are already skipped individually
   - Action: Review snapshot availability and test requirements

6. **`tests/integration/fuel_accounting.spec.ts`** - Has `test.skip('smelting 9 stone consumes >=2 coal units')`
   - Individual test within active suite
   - Action: Check if fuel accounting logic changed

7. **`tests/unit/combine_similar_nodes.spec.ts`** - Has `test.skip('combineSimilarNodes=false creates separate oak and spruce craft nodes')`
   - May be testing deprecated behavior (non-combined mode)
   - Action: Verify if this mode is still supported

## Investigation Tools

### Find All Skipped Tests
```bash
# Find all describe.skip
grep -rn "describe\.skip" tests/ --include="*.ts" --include="*.spec.ts"

# Find all test.skip
grep -rn "test\.skip" tests/ --include="*.ts" --include="*.spec.ts"

# Count skipped tests
grep -rc "describe\.skip\|test\.skip" tests/ --include="*.ts" | grep -v ":0$"
```

### Run Specific Skipped Test (remove .skip temporarily)
```bash
npm test -- tests/path/to/test.spec.ts
```

### Check Git History
```bash
# When was test skipped?
git log -p --all -S "describe.skip" -- tests/path/to/test.spec.ts

# Who skipped it?
git blame tests/path/to/test.spec.ts
```

### Check Test Performance
```bash
# Run single test file with timing
npm test -- tests/path/to/test.spec.ts --verbose
```

## Documentation Template

For each skipped test reviewed, document:

```markdown
### Test: [test name]
- **Location**: `tests/path/to/file.spec.ts:line`
- **Category**: [Broken/Slow/Flaky/Incomplete/Unimplemented/Obsolete/Unclear]
- **Skip Date**: [from git history]
- **Original Reason**: [from comments or git history]
- **Current Status**: [still relevant? functionality exists?]
- **Decision**: [Re-enable/Fix/Remove/Keep-skipped]
- **Action Taken**: [what was done]
- **Notes**: [any additional context]
```

### Special Template for Unimplemented Features

```markdown
### Test: [test name]
- **Location**: `tests/path/to/file.spec.ts:line`
- **Category**: Unimplemented
- **Missing Functionality**: [what needs to be implemented]
- **Blockers**: [what prevents implementation]
- **Roadmap Status**: [planned/deferred/not-planned]
- **Decision**: [Keep-as-spec/Remove/Convert-to-doc]
- **Action**: 
  - [ ] Add TODO comment with clear requirements
  - [ ] Link to tracking issue (if exists)
  - [ ] Document expected behavior in test comments
  - [ ] Mark with `test.skip()` or `describe.skip()` with reason
```

## Success Metrics

After investigation, we should achieve:
- ✅ All skipped tests have documented reasons
- ✅ Obsolete tests removed (reduce technical debt)
- ✅ Fixable tests re-enabled (increase coverage)
- ✅ Remaining skipped tests have clear justification
- ✅ Test suite confidence improved
- ✅ Total test count more accurately reflects actual coverage

## Expected Outcomes

**Realistic Targets**:
- Re-enable: 30-50% of skipped tests (after optimization/fixes)
- Remove: 20-30% of skipped tests (obsolete)
- Keep skipped: 20-30% of skipped tests (with documentation)
- Need more work: 10-20% of skipped tests (require deeper changes)

**Coverage Improvement**:
- Reduce skipped test count from 76 → ~30-40
- Increase active test count from 241 → ~270-290
- Better confidence in test suite coverage

## Risks and Considerations

1. **Breaking Changes**: Re-enabling tests may reveal bugs in current code
   - This is actually a good thing - better to find bugs in tests than production
   
2. **Test Maintenance**: More active tests = more maintenance
   - Only re-enable tests that provide real value
   - Consider combining redundant tests

3. **Performance Impact**: Re-enabling slow tests may increase runtime
   - Apply optimization techniques first
   - Consider separate slow test suite if needed

4. **False Positives**: Some tests may need updates to match current behavior
   - Verify expected behavior before updating assertions

## Deliverables

1. **Skipped Test Inventory** - Complete list with categorization
2. **Investigation Report** - Findings for each test
3. **Updated Test Suite** - Re-enabled/removed/updated tests
4. **Documentation** - Reasons for remaining skipped tests
5. **Recommendations** - Suggestions for preventing future test skipping

## Notes

- This is a Minecraft automation bot that generates action trees for crafting/mining
- Recent optimizations (caching, limited enumeration) may make previously-slow tests viable
- Variant/combining system has evolved - some tests may be outdated
- World snapshot functionality may have changed
- **State machine building functionality may not be fully implemented** - many skipped tests may be in `behavior_generator/` or `behaviors/` directories waiting on this
- Focus on practical outcomes - not every test needs to be re-enabled
- Tests for unimplemented features can serve as specifications - keep them if they document intended behavior clearly

## Unimplemented Feature Checklist

When investigating tests that may be blocked by unimplemented features:

1. **Check the codebase structure**:
   ```bash
   # What's in behavior_generator?
   ls -la behavior_generator/
   
   # What's in behaviors?
   ls -la behaviors/
   
   # Are there implementation stubs or TODOs?
   grep -rn "TODO\|FIXME\|UNIMPLEMENTED" behavior_generator/ behaviors/
   ```

2. **Check test patterns**:
   - Tests for `buildMachine` or state machine construction
   - Tests for behavior execution or coordination
   - Tests that import from `behavior_generator/` or `behaviors/`
   - Integration tests in `bots/` directory

3. **Decision criteria**:
   - **Keep if**: Feature is on roadmap, test documents intended behavior clearly
   - **Remove if**: Feature abandoned, test is vague or outdated
   - **Update if**: Partial implementation exists, test needs adjustment

4. **Documentation for kept tests**:
   ```typescript
   // TODO: Re-enable when state machine building is implemented
   // Requirements:
   //   - buildMachine() needs to handle craft actions
   //   - Behavior coordination for multi-step plans
   //   - State transitions for inventory changes
   // Related: [link to issue/doc if exists]
   test.skip('builds state machine for crafting workflow', () => {
     // Test implementation serves as specification
   });
   ```

