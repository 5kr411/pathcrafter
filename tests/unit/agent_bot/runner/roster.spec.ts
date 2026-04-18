import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveBotSpecs } from '../../../../bots/agent_bot/runner/roster';

describe('resolveBotSpecs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('roster file returns parsed list', () => {
    const roster = [
      { name: 'a', provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { name: 'b', provider: 'openai-compat', model: 'qwen', baseUrl: 'http://localhost:11434/v1' }
    ];
    const rosterPath = path.join(tmpDir, 'roster.json');
    fs.writeFileSync(rosterPath, JSON.stringify(roster));

    const specs = resolveBotSpecs({ rosterPath });
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ name: 'a', provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(specs[1]).toMatchObject({ name: 'b', provider: 'openai-compat', model: 'qwen', baseUrl: 'http://localhost:11434/v1' });
  });

  it('comma-lists round-robin', () => {
    const specs = resolveBotSpecs({
      providers: ['anthropic', 'openai'],
      models: ['claude-sonnet-4-6', 'gpt-4.1'],
      numBots: 2
    });
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(specs[1]).toMatchObject({ provider: 'openai', model: 'gpt-4.1' });
  });

  it('comma-lists broadcast length-1 arrays', () => {
    const specs = resolveBotSpecs({
      providers: ['anthropic'],
      models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-6'],
      numBots: 3
    });
    expect(specs).toHaveLength(3);
    expect(specs.every(s => s.provider === 'anthropic')).toBe(true);
    expect(specs.map(s => s.model)).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-haiku-4-6'
    ]);
  });

  it('homogeneous fallback returns n identical specs', () => {
    const specs = resolveBotSpecs({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      numBots: 3
    });
    expect(specs).toHaveLength(3);
    for (const s of specs) {
      expect(s).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    }
  });

  it('ragged comma-list errors', () => {
    expect(() =>
      resolveBotSpecs({
        providers: ['anthropic', 'openai', 'gemini'],
        models: ['a', 'b'],
        numBots: 3
      })
    ).toThrow(/length mismatch/);
  });

  it('roster missing provider/model errors', () => {
    const rosterPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(rosterPath, JSON.stringify([{ name: 'x' }]));
    expect(() => resolveBotSpecs({ rosterPath })).toThrow(/missing provider\/model/);
  });

  it('roster requires an array', () => {
    const rosterPath = path.join(tmpDir, 'not-array.json');
    fs.writeFileSync(rosterPath, JSON.stringify({ nope: true }));
    expect(() => resolveBotSpecs({ rosterPath })).toThrow(/JSON array/);
  });

  it('throws when no resolution path matches', () => {
    expect(() => resolveBotSpecs({})).toThrow(/must specify/);
  });
});
