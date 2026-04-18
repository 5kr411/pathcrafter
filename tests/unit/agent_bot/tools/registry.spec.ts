import { allTools } from '../../../../bots/agent_bot/tools/registry';

describe('tool registry', () => {
  const tools = allTools();
  const names = tools.map(t => t.schema.name);

  it('contains exactly 16 tools', () => {
    expect(tools.length).toBe(16);
  });

  it('includes all expected tool names', () => {
    const expected = [
      'get_position', 'get_health', 'get_inventory', 'get_entities',
      'get_time_of_day', 'search_items',
      'goto_position', 'goto_entity', 'hunt_entity', 'eat_food',
      'collect_item',
      'equip_best_armor', 'drop_item', 'look_at', 'wait', 'send_chat'
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it('has unique tool names', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool schema is a JSON object-schema', () => {
    for (const t of tools) {
      expect(t.schema.inputSchema).toBeDefined();
      expect((t.schema.inputSchema as any).type).toBe('object');
    }
  });

  it('every tool has a non-empty description', () => {
    for (const t of tools) {
      expect(typeof t.schema.description).toBe('string');
      expect((t.schema.description || '').length).toBeGreaterThan(0);
    }
  });

  it('every tool has an execute function', () => {
    for (const t of tools) {
      expect(typeof t.execute).toBe('function');
    }
  });
});
