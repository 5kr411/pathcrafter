import * as fs from 'fs';
import * as path from 'path';

describe('craft gate', () => {
  // Source-reading smoke tests: the craft functions are deeply nested in
  // NestedStateMachine factories, so driving them to fire `bot.craft` would
  // require extensive mock scaffolding. The textual-ordering check catches
  // regressions where the gate is removed or re-ordered after bot.craft.
  it('behaviorCraftWithTable calls ensureInventoryRoom before bot.craft', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../behaviors/behaviorCraftWithTable.ts'),
      'utf8'
    );
    const gateIdx = src.indexOf('ensureInventoryRoom');
    const craftIdx = src.indexOf('bot.craft(');
    expect(gateIdx).toBeGreaterThan(0);
    expect(craftIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(craftIdx);
  });

  it('behaviorCraftNoTable calls ensureInventoryRoom before bot.craft', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../behaviors/behaviorCraftNoTable.ts'),
      'utf8'
    );
    const gateIdx = src.indexOf('ensureInventoryRoom');
    const craftIdx = src.indexOf('bot.craft(');
    expect(gateIdx).toBeGreaterThan(0);
    expect(craftIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(craftIdx);
  });

  it('behaviorCraftWithTable imports ensureInventoryRoom', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../behaviors/behaviorCraftWithTable.ts'),
      'utf8'
    );
    expect(src).toMatch(/ensureInventoryRoom/);
  });

  it('behaviorCraftNoTable imports ensureInventoryRoom', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../behaviors/behaviorCraftNoTable.ts'),
      'utf8'
    );
    expect(src).toMatch(/ensureInventoryRoom/);
  });
});
