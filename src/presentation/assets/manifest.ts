/**
 * Asset manifest: visualKey → URL. Game data only references visualKeys, never file names,
 * so art from RPG-GO Arena can be dropped in later by filling these entries.
 *
 * `null` = no asset yet; the renderer draws a procedural graybox placeholder.
 * Example once art exists:
 *   import mageUrl from './characters/mage.png';
 *   hero_mage: mageUrl,
 */
import { CHARACTER_PAINTINGS, CARD_PAINTINGS, MATERIAL_PAINTINGS } from './paintedAssets';
export const ASSET_MANIFEST: Readonly<Record<string, string | null>> = {
  // Characters / units
  hero_mage: CHARACTER_PAINTINGS.mage!,
  enemy_orc_warrior: CHARACTER_PAINTINGS.orc_warrior!,
  enemy_shadow_wolf: CHARACTER_PAINTINGS.shadow_wolf!,
  enemy_dark_shaman: CHARACTER_PAINTINGS.dark_shaman!,
  enemy_stone_brute: CHARACTER_PAINTINGS.stone_brute!,
  objective_crystal: CHARACTER_PAINTINGS.crystal!,
  // Obstacles
  obstacle_pillar: MATERIAL_PAINTINGS.pillar!,
  obstacle_rubble: MATERIAL_PAINTINGS.rubble!,
  obstacle_ice_wall: MATERIAL_PAINTINGS.ice_obstacle!,
  // Card art (keyed by card presentation.visualKey)
  magic_missile: null,
  fireball: null,
  blink: null,
  ice_wall: null,
  arcane_burst: null,
  barrier: null,
  force_push: null,
  frost_nova: null,
  phase_step: null,
  flame_tile: null,
  dispel: null,
  arcane_surge: null,
  ...CARD_PAINTINGS,
};

export function assetUrl(visualKey: string): string | null {
  return ASSET_MANIFEST[visualKey] ?? null;
}
