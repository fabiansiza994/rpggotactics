import type { EnemyDef } from '../domain/content';

/**
 * World 2 «Reino Infernal» enemy family. Same three behaviour primitives as the Ascent roster
 * (MELEE / AREA_CASTER), but each one adds a different consequence through `onHit` (burn, push,
 * scorched ground), so the family asks positional questions instead of carrying more HP:
 *
 * - Diablillo Ígneo:    fragile (3 HP) and fast (4 MP); a weak hit that sets its target BURNING
 *                       (1 dmg at its next 2 turn starts; one burn per unit, Dispel removes it).
 * - Caballero Infernal: armoured frontline that shoves what it hits one tile back — into lava, an
 *                       ally or a wall (collision damage) — so where you stand next to it matters.
 *                       El Carcelero (elite variant, no armour) hits harder and throws two tiles.
 * - Chamán de Ceniza:   ranged cross blast that leaves the centre tile burning for 2 rounds: it
 *                       denies ground more than it deals damage. Fragile in melee.
 * - Bestia de Magma:    elite. Slow, telegraphed 3×3 slam from 2 tiles away that scorches its
 *                       centre: stepping out of the locked area is the answer, not tanking it.
 *                       No armour: its threat is the zone, not being a damage sponge.
 * - El Rey de la Forja: boss. Same slam, wider reach (3), harder, and it throws survivors one
 *                       tile out of the blast; reinforcements and accumulating fire are its
 *                       "phases" (see encounter w2_e10). No armour: with lava immunity, armour
 *                       starved the Mage and Summoner of damage (bot 0%, qa/campaign-worlds).
 *
 * Fire creatures (`hazardImmune`: imp, beast, king) stand in lava unharmed; knights and shamans
 * burn like the player, so pushing them into it is a real play.
 *
 * `visualKey` names the final art each one needs (qa/campaign-worlds/REPORT.md); until Codex
 * delivers it the presentation draws them with borrowed, tinted art (visualIdentity.ts).
 */
export const INFERNAL_ENEMIES: Readonly<Record<string, EnemyDef>> = {
  infernal_imp: {
    id: 'infernal_imp',
    name: 'Diablillo Ígneo',
    role: 'DIVER',
    rank: 'NORMAL',
    maxHp: 3,
    armor: 0,
    moveRange: 4,
    behavior: { type: 'MELEE', damage: 1, damageType: 'FIRE', onHit: { status: { status: 'BURNING', duration: 2 } } },
    visualKey: 'enemy_infernal_imp',
    hazardImmune: true,
  },
  infernal_knight: {
    id: 'infernal_knight',
    name: 'Caballero Infernal',
    role: 'FRONTLINER',
    rank: 'NORMAL',
    maxHp: 8,
    armor: 1,
    moveRange: 2,
    behavior: { type: 'MELEE', damage: 3, damageType: 'PHYSICAL', onHit: { push: { distance: 1, collisionDamage: 1 } } },
    visualKey: 'enemy_infernal_knight',
  },
  /** Elite knight (encounter XV): heavier blow that throws its target TWO tiles. */
  infernal_jailer: {
    id: 'infernal_jailer',
    name: 'El Carcelero',
    role: 'FRONTLINER',
    rank: 'ELITE',
    maxHp: 12,
    armor: 0,
    moveRange: 2,
    behavior: { type: 'MELEE', damage: 4, damageType: 'PHYSICAL', onHit: { push: { distance: 2, collisionDamage: 1 } } },
    visualKey: 'enemy_infernal_jailer',
  },
  ash_shaman: {
    id: 'ash_shaman',
    name: 'Chamán de Ceniza',
    role: 'RANGED',
    rank: 'NORMAL',
    maxHp: 5,
    armor: 0,
    moveRange: 2,
    behavior: {
      type: 'AREA_CASTER',
      damage: 2,
      damageType: 'FIRE',
      castRange: 4,
      area: { shape: 'CROSS', radius: 1 },
      onHit: { scorch: { terrain: 'FIRE', turns: 2, tiles: 'CENTER' } },
    },
    visualKey: 'enemy_ash_shaman',
  },
  magma_beast: {
    id: 'magma_beast',
    name: 'Bestia de Magma',
    role: 'TANK',
    rank: 'ELITE',
    maxHp: 12,
    armor: 0,
    moveRange: 2,
    behavior: {
      type: 'AREA_CASTER',
      damage: 4,
      damageType: 'FIRE',
      castRange: 2,
      area: { shape: 'SQUARE', radius: 1, includeCenter: true },
      onHit: { scorch: { terrain: 'FIRE', turns: 2, tiles: 'CENTER' } },
    },
    visualKey: 'enemy_magma_beast',
    hazardImmune: true,
  },
  forge_king: {
    id: 'forge_king',
    name: 'El Rey de la Forja',
    role: 'TANK',
    rank: 'BOSS',
    maxHp: 18,
    armor: 0,
    moveRange: 2,
    behavior: {
      type: 'AREA_CASTER',
      damage: 5,
      damageType: 'FIRE',
      castRange: 3,
      area: { shape: 'SQUARE', radius: 1, includeCenter: true },
      onHit: { push: { distance: 1, collisionDamage: 1 }, scorch: { terrain: 'FIRE', turns: 3, tiles: 'CENTER' } },
    },
    visualKey: 'enemy_forge_king',
    hazardImmune: true,
  },
};
