import * as fs from 'fs';
import type { ProviderConfig } from '../providers/types';

export interface BotSpec {
  name?: string;
  provider: ProviderConfig['provider'];
  model: string;
  baseUrl?: string;
  targets?: { item: string; count: number }[];
}

export interface RunnerArgs {
  rosterPath?: string;
  providers?: string[];
  models?: string[];
  baseUrls?: string[];
  provider?: string;
  model?: string;
  baseUrl?: string;
  numBots?: number;
}

export function resolveBotSpecs(args: RunnerArgs): BotSpec[] {
  if (args.rosterPath) {
    const raw = JSON.parse(fs.readFileSync(args.rosterPath, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('roster must be a JSON array');
    for (const entry of raw) {
      if (!entry.provider || !entry.model) {
        throw new Error(`roster entry missing provider/model: ${JSON.stringify(entry)}`);
      }
    }
    return raw;
  }

  if (args.providers && args.models) {
    const n = args.numBots ?? Math.max(args.providers.length, args.models.length);
    const expand = (arr: string[], len: number, label: string): string[] => {
      if (arr.length === len) return arr;
      if (arr.length === 1) return Array(len).fill(arr[0]);
      throw new Error(`${label} length mismatch: got ${arr.length}, expected ${len} or 1`);
    };
    const providers = expand(args.providers, n, 'providers');
    const models = expand(args.models, n, 'models');
    const baseUrls = args.baseUrls
      ? expand(args.baseUrls, n, 'base-urls')
      : Array(n).fill(undefined);
    const specs: BotSpec[] = [];
    for (let i = 0; i < n; i++) {
      specs.push({
        provider: providers[i] as ProviderConfig['provider'],
        model: models[i],
        baseUrl: baseUrls[i] || undefined
      });
    }
    return specs;
  }

  if (args.provider && args.model && args.numBots) {
    return Array.from({ length: args.numBots }, () => ({
      provider: args.provider as ProviderConfig['provider'],
      model: args.model!,
      baseUrl: args.baseUrl
    }));
  }

  throw new Error(
    'must specify --roster, or --providers/--models [+--num-bots], or --provider/--model/--num-bots'
  );
}
