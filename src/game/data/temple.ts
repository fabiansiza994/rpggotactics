import type { EnemyDef } from '../domain/content';
import type { ObstacleDef } from '../domain/entities/obstacle';

/**
 * Act III «El Templo del Umbral» enemies. The Mechanical Guardian is an ordinary enemy definition:
 * its plating (FORTIFIED: attacks deal 2 less) is put on and taken off by the encounter's
 * mechanism rules (FORTIFY / EXPOSE actions), never by code specific to this unit.
 *
 * Its blow knocks the champion back 1 tile: it keeps you off the levers it guards.
 * Placeholder art: the stone brute's sprite until Codex delivers `enemy_temple_guardian`.
 */
export const TEMPLE_ENEMIES: Readonly<Record<string, EnemyDef>> = {
  temple_guardian: {
    id: 'temple_guardian',
    name: 'Guardián Mecánico',
    role: 'TANK',
    rank: 'ELITE',
    // 14 (was 16): with the relocating lever the core is open ~3 of every 5 rounds instead of always.
    maxHp: 14,
    armor: 0,
    moveRange: 2,
    behavior: { type: 'MELEE', damage: 3, damageType: 'PHYSICAL', onHit: { push: { distance: 1, collisionDamage: 0 } } },
    visualKey: 'enemy_stone_brute',
  },
  /**
   * XXIX elite: the Heart's sentinel. The Guardian's blow (3 + knock back 1) on a lighter frame:
   * the Heart's corridor is single file, and a 14-HP Guardian there was a wall, not a fight.
   * Placeholder art: the Guardian's.
   */
  heart_warden: {
    id: 'heart_warden',
    name: 'Centinela del Corazón',
    role: 'TANK',
    rank: 'ELITE',
    maxHp: 10,
    armor: 0,
    moveRange: 2,
    behavior: { type: 'MELEE', damage: 3, damageType: 'PHYSICAL', onHit: { push: { distance: 1, collisionDamage: 0 } } },
    visualKey: 'enemy_stone_brute',
  },
  /**
   * XXX boss. Its BOARD control (turning the sanctum, raising/lowering the dais walls) is not in
   * this definition: those are the encounter's telegraphed round rules (`whileAlive` this unit).
   * Here only its own blow: a locked cross-shaped rune burst (telegraphed like every caster, the
   * champion can step out of it); below half HP the burst becomes a 3×3 square.
   * Placeholder art: the dark shaman's sprite until Codex delivers `enemy_temple_architect`.
   */
  temple_architect: {
    id: 'temple_architect',
    name: 'Arquitecto del Umbral',
    role: 'RANGED',
    rank: 'BOSS',
    maxHp: 18,
    armor: 0,
    moveRange: 1,
    behavior: { type: 'AREA_CASTER', damage: 4, damageType: 'ARCANE', castRange: 4, area: { shape: 'CROSS', radius: 1 } },
    phases: [
      {
        belowHpPct: 50,
        name: 'Planos rotos',
        behavior: { type: 'AREA_CASTER', damage: 4, damageType: 'ARCANE', castRange: 4, area: { shape: 'SQUARE', radius: 1, includeCenter: true } },
      },
    ],
    visualKey: 'enemy_dark_shaman',
  },
};

/**
 * Act III phase 3 «El Laberinto Vivo»: low mechanical blocks that partition rotating sections. They
 * stop movement but never sight (the champion stays visible; the Archer can shoot across).
 */
export const TEMPLE_OBSTACLES: Readonly<Record<string, ObstacleDef>> = {
  temple_block: {
    id: 'temple_block',
    name: 'Bloque del mecanismo',
    blocksMovement: true,
    blocksLineOfSight: false,
    visualKey: 'obstacle_temple_block',
  },
};
