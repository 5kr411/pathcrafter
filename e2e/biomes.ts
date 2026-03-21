export const GOOD_BIOMES: string[] = ['old_growth_pine_taiga'];

export function pickRandomBiome(): string {
  const idx = Math.floor(Math.random() * GOOD_BIOMES.length);
  return GOOD_BIOMES[idx];
}
