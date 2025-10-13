import { logActionPath } from '../../action_tree/logger';

describe('unit: logger smelt formatting', () => {
  test('logActionPath includes smelt input and output', () => {
    const path = [
      {
        action: 'smelt',
        variantMode: 'any_of',
        what: { mode: 'any_of', variants: [{ value: 'furnace' }] },
        count: 3,
        input: { mode: 'any_of', variants: [{ value: { item: 'raw_iron', perSmelt: 1 } }] },
        result: { mode: 'any_of', variants: [{ value: { item: 'iron_ingot', perSmelt: 1 } }] },
        fuel: { mode: 'any_of', variants: [{ value: 'coal' }] }
      } as any
    ];

    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const logger = require('../../utils/logger').default;
    const spyInfo = jest.spyOn(logger, 'info').mockImplementation(() => {});

    logActionPath(path as any);

    const calls = spyInfo.mock.calls.map(args => String(args[0] ?? ''));
    const line = calls.join('\n');
    expect(line).toMatch(/raw_iron/);
    expect(line).toMatch(/iron_ingot/);
    expect(line).toMatch(/smelt in furnace/);

    spy.mockRestore();
    spyInfo.mockRestore();
  });
});


