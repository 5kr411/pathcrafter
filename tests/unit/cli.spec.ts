describe('parseCliTargets', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  function setArgv(...extra: string[]): void {
    process.argv = ['node', 'script.js', ...extra];
  }

  // Must re-import each time since parseCliTargets reads process.argv at call time
  function getParser() {
    return require('../../utils/cli').parseCliTargets;
  }

  it('returns null when --targets is not present', () => {
    setArgv();
    expect(getParser()()).toBeNull();
  });

  it('returns null when --targets has no value', () => {
    setArgv('--targets');
    expect(getParser()()).toBeNull();
  });

  it('returns null when --targets value is empty string', () => {
    setArgv('--targets', '');
    expect(getParser()()).toBeNull();
  });

  it('parses a single target', () => {
    setArgv('--targets', 'oak_log 16');
    const result = getParser()();
    expect(result).toEqual([{ item: 'oak_log', count: 16 }]);
  });

  it('parses multiple comma-separated targets', () => {
    setArgv('--targets', 'oak_log 16, cobblestone 32');
    const result = getParser()();
    expect(result).toEqual([
      { item: 'oak_log', count: 16 },
      { item: 'cobblestone', count: 32 }
    ]);
  });

  it('returns null for invalid target format', () => {
    setArgv('--targets', 'invalid');
    expect(getParser()()).toBeNull();
  });

  it('ignores --targets appearing as a value rather than a flag', () => {
    setArgv('--other', '--targets');
    expect(getParser()()).toBeNull();
  });

  it('works with other args before --targets', () => {
    setArgv('localhost', '25565', 'collector', '--targets', 'diamond 4');
    const result = getParser()();
    expect(result).toEqual([{ item: 'diamond', count: 4 }]);
  });
});
