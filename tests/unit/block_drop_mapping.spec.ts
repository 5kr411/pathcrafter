import * as treeBuild from '../../action_tree/build';

describe('unit: block drop mapping via minecraft-data', () => {
  const ctx = '1.20.1';

  test('coal is dropped by coal_ore and deepslate_coal_ore', () => {
    const mc = treeBuild.resolveMcData(ctx);
    if (!mc) throw new Error('Failed to resolve minecraft data');
    const sources = treeBuild.findBlocksThatDrop(mc, 'coal');
    const names = new Set(sources.map(s => s.block));
    expect(names.has('coal_ore')).toBe(true);
    expect(names.has('deepslate_coal_ore')).toBe(true);
  });

  test('raw_iron is dropped by iron_ore and deepslate_iron_ore', () => {
    const mc = treeBuild.resolveMcData(ctx);
    if (!mc) throw new Error('Failed to resolve minecraft data');
    const sources = treeBuild.findBlocksThatDrop(mc, 'raw_iron');
    const names = new Set(sources.map(s => s.block));
    expect(names.has('iron_ore')).toBe(true);
    expect(names.has('deepslate_iron_ore')).toBe(true);
  });
});

