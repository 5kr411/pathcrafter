import { getDroppedItemInfo } from '../../utils/droppedItems';

describe('getDroppedItemInfo', () => {
  it('uses getDroppedItem when available', () => {
    const entity = {
      getDroppedItem: () => ({ name: 'oak_log', count: 3 })
    };

    expect(getDroppedItemInfo(entity)).toEqual({ name: 'oak_log', count: 3 });
  });

  it('defaults count to 1 when getDroppedItem count missing', () => {
    const entity = {
      getDroppedItem: () => ({ name: 'stick' })
    };

    expect(getDroppedItemInfo(entity)).toEqual({ name: 'stick', count: 1 });
  });

  it('falls back to metadata with mcData mapping', () => {
    const mcData = {
      items: [] as Array<{ name?: string }>
    };
    mcData.items[5] = { name: 'dirt' };

    const entity = {
      metadata: [] as any[]
    };
    entity.metadata[7] = { itemId: 5, itemCount: 2 };

    expect(getDroppedItemInfo(entity, mcData)).toEqual({ name: 'dirt', count: 2 });
  });

  it('uses metadata name when provided without mcData', () => {
    const entity = {
      metadata: [] as any[]
    };
    entity.metadata[7] = { itemId: 42, itemCount: 4, name: 'custom_item' };

    expect(getDroppedItemInfo(entity)).toEqual({ name: 'custom_item', count: 4 });
  });

  it('falls back to item_{id} when no name exists', () => {
    const entity = {
      metadata: [] as any[]
    };
    entity.metadata[7] = { itemId: 9 };

    expect(getDroppedItemInfo(entity)).toEqual({ name: 'item_9', count: 1 });
  });

  it('returns null and 0 when no data is present', () => {
    expect(getDroppedItemInfo({})).toEqual({ name: null, count: 0 });
  });

  it('handles getDroppedItem throwing and still checks metadata', () => {
    const entity = {
      getDroppedItem: () => {
        throw new Error('boom');
      },
      metadata: [] as any[]
    };
    entity.metadata[8] = { itemId: 7, itemCount: 1, name: 'bedrock' };

    expect(getDroppedItemInfo(entity)).toEqual({ name: 'bedrock', count: 1 });
  });
});
