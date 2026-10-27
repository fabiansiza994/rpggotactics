import type { CardDefinition } from '../domain/cards/card';
import type { SummonDef } from '../domain/content';
import type { RitualDef } from '../domain/rituals/ritual';
import { piece, SUMMON_TILE } from './summoner-rituals';

/**
 * LEGENDARY SUMMONER RITUAL — Dragón Primordial (qa/primordial-dragon/REPORT.md).
 *
 * Seal one Garra, one Colmillo, one Ala and one Corazón on the altar (4 distinct pieces, the
 * altar holds no duplicates), then activate for 3 energy → the Dragón Primordial replaces every
 * summon of the caster. Once per battle.
 *
 * vs Dragón de Guerra (direct summon, one card, 18 HP): this one needs a deck built around four
 * specific seals and several turns, and pays it back with a far bigger body and a signature breath.
 *
 * Seals are RARE but allow 2 copies each (`maxCopies`): a dedicated 30-card deck runs 8 slots.
 * With 1 copy each the ritual completed in ≈1% of battles (qa/ritual-simplification).
 * Played normally each seal is a modest 1-energy effect, so a seal is never a dead draw.
 *
 * Set `summoner_primordial`: in DEFAULT_CONTENT (decks, battles, replays and PvP accept it for a
 * player who owns the seals) but never dropped, sold or granted until the set is released
 * (server PRIMORDIAL_DRAGON_ENABLED / guest VITE_PRIMORDIAL_DRAGON). visualKeys are placeholders
 * until the Codex art pass (qa/primordial-dragon/REPORT.md "Codex visual contract").
 */
export const PRIMORDIAL_EXPANSION = 'summoner_primordial';

const RITUAL_NAME = 'Dragón Primordial';

const seal = (card: CardDefinition): CardDefinition => ({
  ...card,
  tags: [...card.tags, 'legendary-piece', 'primordial'],
  // Showcase presentation (premium frame, foil, parallax). Presentation only: never power or economy.
  presentation: { ...card.presentation, premiumTreatment: 'showcase' },
  maxCopies: 2,
  expansion: PRIMORDIAL_EXPANSION,
});

export const PRIMORDIAL_CARDS: CardDefinition[] = [
  seal(
    piece('seal_claw', 'Sello de la Garra Primordial', 'RARE', RITUAL_NAME, {
      // Marca del Colmillo's echo: a single point of chip damage, never a real attack card.
      cost: 1,
      category: 'ATTACK',
      tags: ['damage'],
      text: 'inflige 1 de daño físico a un enemigo a distancia 2.',
      targeting: { type: 'UNIT', range: 2, unitFilter: 'ENEMY', requiresLineOfSight: true },
      effects: [{ type: 'DAMAGE', amount: 1, damageType: 'PHYSICAL', to: 'ENEMIES', attackKind: 'RANGED' }],
    }),
  ),
  seal(
    piece('seal_fang', 'Sello del Colmillo Primordial', 'RARE', RITUAL_NAME, {
      // Marcar Presa (RARE, 1 energy) marks at distance 4; this one only at 2.
      cost: 1,
      category: 'CONTROL',
      tags: ['control', 'summon-synergy'],
      text: 'marca como presa a un enemigo a distancia 2 durante 1 ronda (tus invocaciones lo persiguen).',
      targeting: { type: 'UNIT', range: 2, unitFilter: 'ENEMY', requiresLineOfSight: true },
      effects: [{ type: 'APPLY_STATUS', status: 'MARKED_PREY', duration: 1, to: 'ENEMIES' }],
    }),
  ),
  seal(
    piece('seal_wing', 'Sello del Ala Primordial', 'RARE', RITUAL_NAME, {
      // Paso atrás (neutral COMMON) steps 1 for the same energy; still no teleport, no root escape.
      cost: 1,
      category: 'MOVEMENT',
      tags: ['movement'],
      text: 'te mueves hasta 2 casillas a una casilla libre sin gastar movimiento (no funciona si estás Enraizado).',
      targeting: { type: 'STEP', range: 2 },
      effects: [{ type: 'STEP_CASTER' }],
    }),
  ),
  seal(
    piece('seal_heart', 'Sello del Corazón Primordial', 'RARE', RITUAL_NAME, {
      // Pacto protector gives 3.
      cost: 1,
      category: 'DEFENSE',
      tags: ['support'],
      text: 'ganas 2 de escudo.',
      targeting: { type: 'SELF' },
      effects: [{ type: 'SHIELD', amount: 2, to: 'CASTER' }],
    }),
  ),
];

export const PRIMORDIAL_SUMMONS: Readonly<Record<string, SummonDef>> = {
  /**
   * Legendary ritual creature. Big but answerable: no immunity, armor 1, slow-ish (2), a melee
   * bite, and a breath that only comes back every other round. Takes the whole capacity (2).
   */
  primordial_dragon: {
    id: 'primordial_dragon',
    name: 'Dragón Primordial',
    behavior: 'PRESSURE',
    attackRange: 1,
    damageType: 'PHYSICAL',
    maxHp: 26,
    armor: 1,
    moveRange: 2,
    damage: 5,
    capacityCost: 2,
    visualKey: 'primordial_dragon',
    breath: { name: 'Aliento Primordial', range: 2, damage: 4, damageType: 'ARCANE', cooldownRounds: 2 },
  },
};

export const PRIMORDIAL_RITUALS: Readonly<Record<string, RitualDef>> = {
  primordial_dragon: {
    id: 'primordial_dragon',
    name: 'Ritual del Dragón Primordial',
    heroId: 'summoner',
    tier: 'LEGENDARY',
    pieces: ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart'],
    // Fast-balance probe: 3 kept (qa/primordial-dragon/REPORT.md). Never above 3.
    energyCost: 3,
    targeting: SUMMON_TILE,
    // Sacrifice: every summon leaves, the dragon takes the whole capacity. Once per battle.
    dismissSummons: true,
    limitPerBattle: 1,
    result: { kind: 'SUMMON_CREATURE', effects: [{ type: 'SUMMON', summonId: 'primordial_dragon' }] },
    rulesText:
      'Despide a tus invocaciones e invoca al Dragón Primordial (26 HP · armadura 1 · mueve 2 · mordisco 5 · capacidad 2) a distancia 2. Aliento Primordial: 4 de daño arcano en cono corto (distancia 2) a todos los enemigos, cada 2 rondas. Una vez por combate.',
    presentation: { visualKey: 'ritual_primordial_dragon' },
  },
};

/** Release metadata (no store offers yet). */
export const PRIMORDIAL_SET = {
  expansion: PRIMORDIAL_EXPANSION,
  seals: PRIMORDIAL_CARDS.map((c) => c.id),
  ritual: 'primordial_dragon',
  creature: 'primordial_dragon',
} as const;
