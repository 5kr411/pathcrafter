import type { ToolImpl } from '../types';
import { resolveMcData } from '../../../../action_tree/utils/mcDataResolver';

interface SearchResult {
  name: string;
  displayName: string;
  type: 'item' | 'block';
}

export const searchItemsTool: ToolImpl = {
  schema: {
    name: 'search_items',
    description: 'Substring-search Minecraft items and blocks by name or display name. Returns up to `limit` (default 20) results.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 20 }
      },
      required: ['query']
    }
  },
  async execute(input, ctx) {
    const query = typeof (input as any)?.query === 'string' ? (input as any).query : '';
    if (!query) return { ok: false, error: 'query is required' };
    const limit = typeof (input as any)?.limit === 'number' ? (input as any).limit : 20;

    const mcData: any = resolveMcData(ctx.bot);
    if (!mcData) return { ok: false, error: 'mcData unavailable' };

    const needle = query.toLowerCase();
    const seen = new Set<string>();
    const results: SearchResult[] = [];

    const matches = (entry: any): boolean => {
      if (!entry || typeof entry.name !== 'string') return false;
      if (entry.name.toLowerCase().includes(needle)) return true;
      if (typeof entry.displayName === 'string' && entry.displayName.toLowerCase().includes(needle)) return true;
      return false;
    };

    const items: any[] = Array.isArray(mcData.itemsArray) ? mcData.itemsArray : [];
    for (const it of items) {
      if (results.length >= limit) break;
      if (seen.has(it.name)) continue;
      if (matches(it)) {
        seen.add(it.name);
        results.push({ name: it.name, displayName: it.displayName ?? it.name, type: 'item' });
      }
    }

    const blocks: any[] = Array.isArray(mcData.blocksArray) ? mcData.blocksArray : [];
    for (const b of blocks) {
      if (results.length >= limit) break;
      if (seen.has(b.name)) continue;
      if (matches(b)) {
        seen.add(b.name);
        results.push({ name: b.name, displayName: b.displayName ?? b.name, type: 'block' });
      }
    }

    return { ok: true, data: { results } };
  }
};
