import * as fs from 'fs';
import { Target } from '../collector/config';
import { parseTargetsFromMessage } from '../collector/chat_handler';

export interface AgentConfig {
  targets: Target[];
  numBots: number;
  host: string;
  port: number;
  usernameBase: string;
  timeoutMs: number;
  perTargetTimeoutMs: number;
  staggerMs: number;
}

const DEFAULTS: Omit<AgentConfig, 'targets'> = {
  numBots: 1,
  host: 'localhost',
  port: 25565,
  usernameBase: 'abot',
  timeoutMs: 600000,
  perTargetTimeoutMs: 120000,
  staggerMs: 2000
};

function parseTargetsString(raw: string): Target[] {
  return parseTargetsFromMessage('collect ' + raw);
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export function parseAgentConfig(argv: string[] = process.argv): AgentConfig {
  const configPath = getArgValue(argv, '--config');

  if (configPath) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const json = JSON.parse(raw);

    const targets = typeof json.targets === 'string'
      ? parseTargetsString(json.targets)
      : Array.isArray(json.targets)
        ? json.targets
        : [];

    return {
      targets,
      numBots: json.numBots ?? DEFAULTS.numBots,
      host: json.host ?? DEFAULTS.host,
      port: json.port ?? DEFAULTS.port,
      usernameBase: json.usernameBase ?? DEFAULTS.usernameBase,
      timeoutMs: json.timeoutMs ?? DEFAULTS.timeoutMs,
      perTargetTimeoutMs: json.perTargetTimeoutMs ?? DEFAULTS.perTargetTimeoutMs,
      staggerMs: json.staggerMs ?? DEFAULTS.staggerMs
    };
  }

  const targetsRaw = getArgValue(argv, '--targets');
  if (!targetsRaw) {
    throw new Error('Either --targets or --config must be provided');
  }

  const targets = parseTargetsString(targetsRaw);
  if (targets.length === 0) {
    throw new Error('No valid targets parsed from: ' + targetsRaw);
  }

  return {
    targets,
    numBots: Number(getArgValue(argv, '--num-bots')) || DEFAULTS.numBots,
    host: getArgValue(argv, '--host') ?? DEFAULTS.host,
    port: Number(getArgValue(argv, '--port')) || DEFAULTS.port,
    usernameBase: getArgValue(argv, '--username-base') ?? DEFAULTS.usernameBase,
    timeoutMs: Number(getArgValue(argv, '--timeout')) || DEFAULTS.timeoutMs,
    perTargetTimeoutMs: Number(getArgValue(argv, '--per-target-timeout')) || DEFAULTS.perTargetTimeoutMs,
    staggerMs: Number(getArgValue(argv, '--stagger-ms') ?? DEFAULTS.staggerMs)
  };
}
