import { appendBoundedStderr, STDERR_CAP } from '../../bots/collector_runner/stderr_buffer';

describe('appendBoundedStderr', () => {
  it('concatenates when result is under cap', () => {
    expect(appendBoundedStderr('foo', 'bar', 100)).toBe('foobar');
  });

  it('does not truncate when result is exactly at cap', () => {
    const result = appendBoundedStderr('a'.repeat(50), 'b'.repeat(50), 100);
    expect(result.length).toBe(100);
    expect(result).toBe('a'.repeat(50) + 'b'.repeat(50));
  });

  it('keeps last `cap` bytes when overflowed by appending', () => {
    const result = appendBoundedStderr('a'.repeat(80), 'b'.repeat(40), 100);
    expect(result.length).toBe(100);
    expect(result).toBe('a'.repeat(60) + 'b'.repeat(40));
  });

  it('keeps last `cap` bytes when a single chunk exceeds cap', () => {
    const result = appendBoundedStderr('', 'a'.repeat(50) + 'b'.repeat(200), 100);
    expect(result.length).toBe(100);
    expect(result).toBe('b'.repeat(100));
  });

  it('never grows past cap across many appends', () => {
    let buf = '';
    for (let i = 0; i < 1000; i++) {
      buf = appendBoundedStderr(buf, `chunk${i}\n`, 256);
      expect(buf.length).toBeLessThanOrEqual(256);
    }
  });

  it('exposes a sensible default cap', () => {
    expect(STDERR_CAP).toBe(10 * 1024);
  });
});
