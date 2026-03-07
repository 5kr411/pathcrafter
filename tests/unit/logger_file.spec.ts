import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../../utils/logger';

describe('Logger file logging', () => {
  let tmpDir: string;
  let loggerInstance: Logger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
    loggerInstance = new Logger();
    loggerInstance.setLevel('DEBUG');
  });

  afterEach(async () => {
    await loggerInstance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initFileLogging creates a log file after first write', async () => {
    loggerInstance.initFileLogging(tmpDir, 'testbot');
    loggerInstance.info('init');
    await loggerInstance.close();
    const logPath = path.join(tmpDir, 'testbot.log');
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it('_log writes valid JSON lines to the file', async () => {
    loggerInstance.initFileLogging(tmpDir, 'testbot');
    loggerInstance.info('hello world');
    loggerInstance.warn('a warning');
    await loggerInstance.close();

    const logPath = path.join(tmpDir, 'testbot.log');
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);

    const entry1 = JSON.parse(lines[0]);
    expect(entry1.level).toBe('INFO');
    expect(entry1.bot).toBe('testbot');
    expect(entry1.msg).toBe('hello world');
    expect(entry1.ts).toBeDefined();
    expect(entry1.source).toBeDefined();

    const entry2 = JSON.parse(lines[1]);
    expect(entry2.level).toBe('WARN');
    expect(entry2.msg).toBe('a warning');
  });

  it('console is suppressed for DEBUG/INFO when file logging is active', () => {
    loggerInstance.initFileLogging(tmpDir, 'testbot');
    const spy = jest.spyOn(console, 'log').mockImplementation();

    loggerInstance.debug('debug msg');
    loggerInstance.info('info msg');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('console is NOT suppressed for WARN/ERROR when file logging is active', () => {
    loggerInstance.initFileLogging(tmpDir, 'testbot');
    const spy = jest.spyOn(console, 'log').mockImplementation();

    loggerInstance.warn('warn msg');
    loggerInstance.error('error msg');

    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('milestone writes to both file and console', async () => {
    loggerInstance.initFileLogging(tmpDir, 'testbot');
    const spy = jest.spyOn(console, 'log').mockImplementation();

    loggerInstance.milestone('key event');

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    await loggerInstance.close();

    const logPath = path.join(tmpDir, 'testbot.log');
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe('MILESTONE');
    expect(entry.msg).toBe('key event');
  });

  it('close flushes and closes the file stream', async () => {
    loggerInstance.initFileLogging(tmpDir, 'testbot');
    loggerInstance.info('test');
    await loggerInstance.close();

    const logPath = path.join(tmpDir, 'testbot.log');
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content.trim()).not.toBe('');
  });

  it('works normally without file logging initialized', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    loggerInstance.info('no file');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
