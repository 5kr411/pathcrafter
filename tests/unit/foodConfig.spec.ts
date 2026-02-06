import {
  HUNTABLE_LAND_ANIMALS,
  HUNTABLE_WATER_ANIMALS,
  ALL_HUNTABLE_ANIMALS,
  FOOD_ITEMS,
  getCookedVariant,
  getEntityForFoodDrop,
  selectBestFoodTarget
} from '../../utils/foodConfig';

describe('foodConfig', () => {
  describe('HUNTABLE_LAND_ANIMALS', () => {
    it('contains only land animals', () => {
      const names = HUNTABLE_LAND_ANIMALS.map(a => a.entity);
      expect(names).toEqual(['cow', 'pig', 'sheep', 'chicken', 'rabbit']);
    });

    it('does not contain water animals', () => {
      const names = HUNTABLE_LAND_ANIMALS.map(a => a.entity);
      expect(names).not.toContain('salmon');
      expect(names).not.toContain('cod');
    });
  });

  describe('HUNTABLE_WATER_ANIMALS', () => {
    it('is empty while pathfinder does not support water', () => {
      expect(HUNTABLE_WATER_ANIMALS).toEqual([]);
    });

    it('does not contain land animals', () => {
      const names = HUNTABLE_WATER_ANIMALS.map(a => a.entity);
      expect(names).not.toContain('cow');
      expect(names).not.toContain('pig');
    });
  });

  describe('ALL_HUNTABLE_ANIMALS', () => {
    it('has length equal to land + water combined', () => {
      expect(ALL_HUNTABLE_ANIMALS.length).toBe(
        HUNTABLE_LAND_ANIMALS.length + HUNTABLE_WATER_ANIMALS.length
      );
    });
  });

  describe('FOOD_ITEMS', () => {
    it('has raw and cooked salmon entries', () => {
      expect(FOOD_ITEMS['salmon']).toBeDefined();
      expect(FOOD_ITEMS['salmon'].hungerPoints).toBe(2);
      expect(FOOD_ITEMS['cooked_salmon']).toBeDefined();
      expect(FOOD_ITEMS['cooked_salmon'].hungerPoints).toBe(6);
      expect(FOOD_ITEMS['cooked_salmon'].isCooked).toBe(true);
    });

    it('has raw and cooked cod entries', () => {
      expect(FOOD_ITEMS['cod']).toBeDefined();
      expect(FOOD_ITEMS['cod'].hungerPoints).toBe(2);
      expect(FOOD_ITEMS['cooked_cod']).toBeDefined();
      expect(FOOD_ITEMS['cooked_cod'].hungerPoints).toBe(5);
      expect(FOOD_ITEMS['cooked_cod'].isCooked).toBe(true);
    });
  });

  describe('getCookedVariant', () => {
    it('returns cooked_salmon for salmon', () => {
      expect(getCookedVariant('salmon')).toBe('cooked_salmon');
    });

    it('returns cooked_cod for cod', () => {
      expect(getCookedVariant('cod')).toBe('cooked_cod');
    });
  });

  describe('getEntityForFoodDrop', () => {
    it('returns null for salmon drop while water animals are disabled', () => {
      expect(getEntityForFoodDrop('salmon')).toBeNull();
    });

    it('returns null for cod drop while water animals are disabled', () => {
      expect(getEntityForFoodDrop('cod')).toBeNull();
    });

    it('returns cow for beef drop', () => {
      expect(getEntityForFoodDrop('beef')).toBe('cow');
    });
  });

  describe('selectBestFoodTarget', () => {
    it('returns cooked_salmon when salmon entities are available', () => {
      const entities = new Set(['salmon']);
      const blocks = new Set<string>();
      expect(selectBestFoodTarget(entities, blocks)).toBe('cooked_salmon');
    });

    it('returns cooked_cod when cod entities are available', () => {
      const entities = new Set(['cod']);
      const blocks = new Set<string>();
      expect(selectBestFoodTarget(entities, blocks)).toBe('cooked_cod');
    });

    it('prefers land animals over fish', () => {
      const entities = new Set(['cow', 'salmon']);
      const blocks = new Set<string>();
      expect(selectBestFoodTarget(entities, blocks)).toBe('cooked_beef');
    });
  });
});
