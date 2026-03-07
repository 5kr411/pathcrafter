import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateRunId, createRunDir, resolveRunDir } from '../../utils/runDir';

describe('runDir', () => {
  describe('generateRunId', () => {
    it('returns a string matching YYYY-MM-DD_HH-MM-SS_<hex> format', () => {
      const id = generateRunId();
      expect(id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[0-9a-f]{6}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 10 }, () => generateRunId()));
      expect(ids.size).toBe(10);
    });
  });

  describe('createRunDir', () => {
    let tmpBase: string;

    beforeEach(() => {
      tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rundir-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    });

    it('creates a directory under the given base', () => {
      const dir = createRunDir(tmpBase);
      expect(fs.existsSync(dir)).toBe(true);
      expect(dir.startsWith(tmpBase)).toBe(true);
    });

    it('directory name matches run ID format', () => {
      const dir = createRunDir(tmpBase);
      const dirName = path.basename(dir);
      expect(dirName).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[0-9a-f]{6}$/);
    });
  });

  describe('resolveRunDir', () => {
    const origEnv = process.env.PATHCRAFTER_RUN_DIR;
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rundir-resolve-'));
    });

    afterEach(() => {
      if (origEnv === undefined) {
        delete process.env.PATHCRAFTER_RUN_DIR;
      } else {
        process.env.PATHCRAFTER_RUN_DIR = origEnv;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uses PATHCRAFTER_RUN_DIR env var when set', () => {
      const envDir = path.join(tmpDir, 'custom-run');
      process.env.PATHCRAFTER_RUN_DIR = envDir;
      const result = resolveRunDir();
      expect(result).toBe(envDir);
      expect(fs.existsSync(envDir)).toBe(true);
    });

    it('creates a new run dir when env var is not set', () => {
      delete process.env.PATHCRAFTER_RUN_DIR;
      const result = resolveRunDir();
      expect(fs.existsSync(result)).toBe(true);
      // Clean up
      fs.rmSync(result, { recursive: true, force: true });
    });
  });
});
