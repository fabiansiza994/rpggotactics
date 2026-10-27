import type { TerrainType } from '../../game';

/** Presentation palette. Terrain materials and unit silhouettes live in arenaArt / unitArt. */
export const PALETTE = {
  background: 0x0b0f17,
  boardEdge: 0x1c2433,
  gridLine: 0x2a3446,
  terrain: {
    COVER: 0x9c8757,
    HAZARD: 0xcf542b,
    ARCANE: 0x9774dc,
    VOID: 0x030811,
    NORMAL: 0x3a4152,
    FIRE: 0x8a3b1e,
    ICE: 0x3f7fa6,
    BLOCKED: 0x0a0c12,
    OBJECTIVE: 0x6b5a1f,
    // World 2 lava: flat placeholder until Codex's infernal board theme.
    LAVA: 0xd2481a,
    // Flecha de Humo cloud: flat placeholder until Codex's smoke VFX.
    SMOKE: 0x8d939c,
  } satisfies Record<TerrainType, number>,
  obstacle: { pillar: 0x7b7f8c, rubble: 0x6b5a4a, ice_wall: 0x9fd8f5 } as Record<string, number>,
  hero: 0x3d8bff,
  enemy: 0xd8434b,
  structure: 0x6ff0ff,
  moveRange: 0x70bada,
  targetRange: 0x88c6d9,
  preview: 0xa4acd8,
  invalid: 0xc77a82,
  intentThreat: 0xc66e7a,
  intentPath: 0xc79e78,
  hover: 0xffffff,
  hpBack: 0x1a1a1a,
  hpHero: 0x4fd06b,
  hpEnemy: 0xe0484f,
  hpStructure: 0x6ff0ff,
  shield: 0xf5d76e,
  damageText: 0xff6b6b,
  healText: 0x6bff9a,
  shieldText: 0xf5d76e,
  text: 0xffffff,
};

/** Graybox glyph per unit definition (placeholder until sprites exist in the asset manifest). */
export const UNIT_GLYPH: Record<string, string> = {
  mage: 'M',
  orc_warrior: 'O',
  shadow_wolf: 'W',
  dark_shaman: 'S',
  stone_brute: 'B',
  crystal: '◆',
};
