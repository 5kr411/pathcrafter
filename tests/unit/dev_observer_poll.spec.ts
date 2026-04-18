import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pollChatIn } from '../../bots/dev_observer/poll';

describe('pollChatIn', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathcrafter-devobs-'));
    file = path.join(dir, 'chat_in');
    fs.writeFileSync(file, '');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('reads appended lines and advances lastSize', () => {
    fs.writeFileSync(file, 'hello\n');
    const lines: string[] = [];
    const r = pollChatIn(file, 0, l => lines.push(l));
    expect(lines).toEqual(['hello']);
    expect(r.lastSize).toBe(6);
  });

  it('reads only the appended delta on a subsequent poll', () => {
    fs.writeFileSync(file, 'hello\n');
    const lines: string[] = [];
    const r1 = pollChatIn(file, 0, l => lines.push(l));
    expect(r1.lastSize).toBe(6);
    fs.appendFileSync(file, 'world\n');
    const r2 = pollChatIn(file, r1.lastSize, l => lines.push(l));
    expect(lines).toEqual(['hello', 'world']);
    expect(r2.lastSize).toBe(12);
  });

  it('resets offset and re-reads after truncation', () => {
    // Start with a larger file.
    fs.writeFileSync(file, 'hello\nworld\n');
    const startingSize = fs.statSync(file).size; // 12
    // Truncate to a smaller content.
    fs.writeFileSync(file, 'new\n'); // 4 bytes < startingSize
    const lines: string[] = [];
    const r = pollChatIn(file, startingSize, l => lines.push(l));
    expect(lines).toEqual(['new']);
    expect(r.lastSize).toBe(4);
  });

  it('returns no lines when file has not grown', () => {
    fs.writeFileSync(file, 'hi\n');
    const lines: string[] = [];
    const r = pollChatIn(file, 3, l => lines.push(l));
    expect(lines).toEqual([]);
    expect(r.lastSize).toBe(3);
    expect(r.linesDelivered).toBe(0);
  });
});
