export const GOOD_BIOMES: string[] = ['forest'];

export function pickRandomBiome(): string {
  const idx = Math.floor(Math.random() * GOOD_BIOMES.length);
  return GOOD_BIOMES[idx];
}
