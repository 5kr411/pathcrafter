import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseAgentConfig } from '../../bots/collector_runner/config_parser';

describe('parseAgentConfig', () => {
  it('parses --targets from argv', () => {
    const argv = ['node', 'agent_runner.js', '--targets', 'oak_log 16, cobblestone 32'];
    const config = parseAgentConfig(argv);
    expect(config.targets).toEqual([
      { item: 'oak_log', count: 16 },
      { item: 'cobblestone', count: 32 }
    ]);
    expect(config.numBots).toBe(1);
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(25565);
    expect(config.timeoutMs).toBe(600000);
  });

  it('parses --num-bots, --host, --port, --timeout', () => {
    const argv = [
      'node', 'agent_runner.js',
      '--targets', 'diamond 4',
      '--num-bots', '3',
      '--host', 'mc.example.com',
      '--port', '25566',
      '--timeout', '300000',
      '--per-target-timeout', '60000'
    ];
    const config = parseAgentConfig(argv);
    expect(config.numBots).toBe(3);
    expect(config.host).toBe('mc.example.com');
    expect(config.port).toBe(25566);
    expect(config.timeoutMs).toBe(300000);
    expect(config.perTargetTimeoutMs).toBe(60000);
  });

  it('throws when no --targets or --config provided', () => {
    const argv = ['node', 'agent_runner.js'];
    expect(() => parseAgentConfig(argv)).toThrow('Either --targets or --config must be provided');
  });

  it('throws when --targets value is invalid', () => {
    const argv = ['node', 'agent_runner.js', '--targets', 'gibberish'];
    expect(() => parseAgentConfig(argv)).toThrow('No valid targets');
  });

  describe('JSON config file', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcfg-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads targets from JSON config file (string format)', () => {
      const cfgPath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(cfgPath, JSON.stringify({
        targets: 'oak_log 8, stone 16',
        numBots: 2,
        host: 'remote.server'
      }));

      const argv = ['node', 'agent_runner.js', '--config', cfgPath];
      const config = parseAgentConfig(argv);
      expect(config.targets).toEqual([
        { item: 'oak_log', count: 8 },
        { item: 'stone', count: 16 }
      ]);
      expect(config.numBots).toBe(2);
      expect(config.host).toBe('remote.server');
    });

    it('reads targets from JSON config file (array format)', () => {
      const cfgPath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(cfgPath, JSON.stringify({
        targets: [{ item: 'diamond', count: 4 }]
      }));

      const argv = ['node', 'agent_runner.js', '--config', cfgPath];
      const config = parseAgentConfig(argv);
      expect(config.targets).toEqual([{ item: 'diamond', count: 4 }]);
    });

    it('uses defaults for missing fields', () => {
      const cfgPath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(cfgPath, JSON.stringify({
        targets: 'iron_ore 8'
      }));

      const argv = ['node', 'agent_runner.js', '--config', cfgPath];
      const config = parseAgentConfig(argv);
      expect(config.numBots).toBe(1);
      expect(config.host).toBe('localhost');
      expect(config.port).toBe(25565);
      expect(config.timeoutMs).toBe(600000);
      expect(config.perTargetTimeoutMs).toBe(120000);
    });
  });
});
