import type { CardDefinition } from '../domain/cards/card';

/**
 * «Recursos tácticos» set: the first NEUTRAL cards (no `heroId`: every champion can collect and
 * equip them, one shared copy pool per account) and three Summoner survivability / command cards.
 * Balance probe and decisions: qa/neutral-summoner-pass/REPORT.md.
 *
 * Neutral identity: simple, general, a notch below each champion's specialty (never the best
 * attack, defence or control of any class). Plain steel / leather / parchment, no champion
 * colour: the frame is derived from `heroId === undefined`, visualKeys are provisional.
 *
 * QA-only like the ritual set: `expansion` keeps every card out of reward drops, the store, promo
 * codes and gifts until the set is released (`GameContent.releasedExpansions`). Battles, decks and
 * PvP never read it, so a player who owns a copy can always use it.
 */
export const TACTICAL_EXPANSION = 'tactical_basics';

const MELEE = { type: 'UNIT', range: 1, unitFilter: 'ENEMY' } as const;

export const NEUTRAL_CARDS: CardDefinition[] = [
  {
    id: 'emergency_strike',
    name: 'Golpe de emergencia',
    cost: 1,
    category: 'ATTACK',
    tags: ['neutral', 'melee'],
    rarity: 'COMMON',
    rulesText: 'Inflige 2 de daño físico a un enemigo adyacente.',
    // Golpe pesado (Warrior) hits 3, 5 with Impulso; Magic Missile hits 2 from range 4.
    targeting: MELEE,
    effects: [{ type: 'DAMAGE', amount: 2, damageType: 'PHYSICAL', to: 'ENEMIES' }],
    expansion: TACTICAL_EXPANSION,
    presentation: { visualKey: 'emergency_strike', element: 'NEUTRAL', castAnimation: 'attack' },
  },
  {
    id: 'take_cover',
    name: 'Ponerse a cubierto',
    cost: 1,
    category: 'DEFENSE',
    tags: ['neutral', 'shield', 'self'],
    rarity: 'COMMON',
    rulesText: 'Ganas 3 de escudo hasta tu próximo turno.',
    // Barrier / Amparo give 4 to any ally at range 3; Guardia gives 4 (and plants you).
    targeting: { type: 'SELF' },
    effects: [{ type: 'SHIELD', amount: 3, to: 'CASTER' }],
    expansion: TACTICAL_EXPANSION,
    presentation: { visualKey: 'take_cover', element: 'SHIELD', castAnimation: 'guard' },
  },
  {
    id: 'step_back',
    name: 'Paso atrás',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['neutral', 'movement'],
    rarity: 'COMMON',
    rulesText:
      'Te mueves 1 casilla a una casilla libre adyacente, sin gastar movimiento. No funciona si estás Enraizado.',
    // A legal walk (no teleport, no root escape). There is no engagement/reaction system to evade.
    targeting: { type: 'STEP', range: 1 },
    effects: [{ type: 'STEP_CASTER' }],
    expansion: TACTICAL_EXPANSION,
    presentation: { visualKey: 'step_back', element: 'NEUTRAL', castAnimation: 'cast_quick' },
  },
  {
    id: 'first_aid',
    name: 'Primeros auxilios',
    cost: 2,
    category: 'DEFENSE',
    tags: ['neutral', 'sustain', 'self'],
    rarity: 'COMMON',
    rulesText: 'Te curas 3 HP.',
    // Self only. Cuidar bandada heals 2 at range 3 for 1; Segundo aliento 2 (5 with Impulso) for 1.
    targeting: { type: 'SELF' },
    effects: [{ type: 'HEAL', amount: 3, to: 'CASTER' }],
    expansion: TACTICAL_EXPANSION,
    presentation: { visualKey: 'first_aid', element: 'SHIELD', castAnimation: 'cast_support' },
  },
  {
    id: 'shove',
    name: 'Empujón',
    cost: 1,
    category: 'CONTROL',
    tags: ['neutral', 'melee', 'push'],
    rarity: 'COMMON',
    rulesText: 'Empuja 1 casilla a un enemigo adyacente. Si choca, 1 de daño.',
    // Empujón brutal pushes 2 (2 on collision, 3/3 with Impulso); Force Push reaches 2 tiles.
    // Probe: with 0 collision damage the card was almost never worth a card (0.03–0.08 plays per
    // game); 1 on collision makes it a real tool and still the weakest push (qa/neutral-summoner-pass).
    targeting: MELEE,
    effects: [{ type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' }],
    expansion: TACTICAL_EXPANSION,
    presentation: { visualKey: 'shove', element: 'FORCE', castAnimation: 'attack' },
  },
];

/**
 * Summoner answers to an enemy in its face, without turning it into a Warrior: the payoff always
 * depends on keeping the army alive (a bonus that never scales with how many summons it has).
 */
export const SUMMONER_BOND_CARDS: CardDefinition[] = [
  {
    id: 'binder_strike',
    name: 'Golpe del Vinculador',
    heroId: 'summoner',
    cost: 1,
    category: 'ATTACK',
    tags: ['melee', 'bond'],
    rarity: 'COMMON',
    rulesText:
      'Inflige 2 de daño físico a un enemigo adyacente. Si una invocación tuya está junto a ese enemigo, inflige 3.',
    targeting: MELEE,
    effects: [
      {
        type: 'DAMAGE',
        amount: 2,
        damageType: 'PHYSICAL',
        to: 'ENEMIES',
        bonus: { when: { type: 'OWN_SUMMON_ADJACENT_TO_TARGET' }, amount: 1 },
      },
    ],
    expansion: TACTICAL_EXPANSION,
    presentation: { visualKey: 'binder_strike', element: 'ARCANE', castAnimation: 'attack' },
  },
  {
    id: 'binding_ward',
    name: 'Vínculo Protector',
    heroId: 'summoner',
    cost: 1,
    category: 'DEFENSE',
    tags: ['shield', 'self', 'bond'],
    rarity: 'UNCOMMON',
    rulesText:
      'Ganas 3 de escudo hasta tu próximo turno; 5 si tienes al menos una invocación en el campo.',
    targeting: { type: 'SELF' },
    effects: [{ type: 'SHIELD', amount: 3, to: 'CASTER', bonus: { when: { type: 'OWN_SUMMON_ALIVE' }, amount: 2 } }],
    expansion: TACTICAL_EXPANSION,
    presentation: { visualKey: 'binding_ward', element: 'SHIELD', castAnimation: 'cast_support' },
  },
  {
    id: 'mark_prey',
    name: 'Marcar Presa',
    heroId: 'summoner',
    cost: 1,
    category: 'CONTROL',
    tags: ['command', 'summon-command', 'mark'],
    rarity: 'RARE',
    rulesText:
      'Marca a un enemigo a distancia 4 con visión durante 3 turnos. Tus invocaciones lo atacan primero si pueden alcanzarlo; si no, avanzan hacia él por un camino seguro. Solo una presa a la vez.',
    targeting: { type: 'UNIT', range: 4, unitFilter: 'ENEMY', requiresLineOfSight: true },
    // 3 turns (was 1): slow summons need the time to arrive (Summoner balance patch).
    effects: [{ type: 'APPLY_STATUS', status: 'MARKED_PREY', duration: 3, to: 'ENEMIES' }],
    expansion: TACTICAL_EXPANSION,
    presentation: { visualKey: 'mark_prey', element: 'ARCANE', castAnimation: 'cast_quick' },
  },
];

export const TACTICAL_CARDS: CardDefinition[] = [...NEUTRAL_CARDS, ...SUMMONER_BOND_CARDS];
