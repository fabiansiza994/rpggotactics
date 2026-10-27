import type { CardDefinition, EffectDef } from '../domain/cards/card';

/**
 * «Vitrina I» — one strong, desirable Showcase Rare per champion, headlining the premium store
 * offers (data/store-catalog.ts). Store policy is unchanged: every card here is ALSO a normal
 * boss/elite reward drop for its champion (no `acquisition`, no store exclusivity, no P2W), RARE =
 * 1 copy per deck, and `premiumTreatment: 'showcase'` is presentation only.
 *
 * Power: each is the strongest card of its role at its cost but pays for it (3 energy, or a
 * whole-army payoff that needs an army). Sanity probe: qa/store-appeal/REPORT.md.
 *
 * QA-only until released like every new set: `expansion` keeps the cards out of drops, promo
 * codes and gifts, and the store does not list an offer holding an unreleased card.
 */
export const SHOWCASE_STORE_EXPANSION = 'showcase_store_01';

const set = { expansion: SHOWCASE_STORE_EXPANSION } as const;
const hit = (amount: number): EffectDef => ({ type: 'DAMAGE', amount, damageType: 'PHYSICAL', to: 'ENEMIES' });

export const SHOWCASE_STORE_CARDS: CardDefinition[] = [
  {
    id: 'frost_comet',
    name: 'Cometa de Escarcha',
    heroId: 'mage',
    cost: 3,
    category: 'CONTROL',
    tags: ['ice', 'area', 'root', 'control', 'showcase'],
    rarity: 'RARE',
    rulesText:
      'Un cometa helado cae en una cruz (radio 1) a distancia 4 con visión: 2 de daño de hielo a cada enemigo y los enraíza 1 turno.',
    // Frost Nova's root at range, on a cross: the Mage's big zone-control spell. 3 of 5 energy;
    // Arcane Burst is the cheaper damage cross (2 for 2), Frost Nova the cheaper close root.
    targeting: { type: 'CROSS', range: 4, radius: 1, requiresLineOfSight: true },
    effects: [
      { type: 'DAMAGE', amount: 2, damageType: 'ICE', to: 'ENEMIES' },
      { type: 'APPLY_STATUS', status: 'ROOTED', duration: 1, to: 'ENEMIES' },
    ],
    ...set,
    presentation: { visualKey: 'frost_comet', element: 'ICE', castAnimation: 'cast_nova', premiumTreatment: 'showcase' },
  },
  {
    id: 'pack_oath',
    name: 'Juramento de la Manada',
    heroId: 'summoner',
    cost: 2,
    category: 'DEFENSE',
    tags: ['support', 'summon-synergy', 'bond', 'showcase'],
    rarity: 'RARE',
    rulesText:
      'Todas tus invocaciones se curan 2 HP y ganan 3 de escudo hasta tu próximo turno. Tú ganas 2 de escudo.',
    // Canto de la manada (1 HP + 1 shield, radius 2, cost 1) for the whole army; Manada Ancestral
    // (ritual) is the offensive twin. Worth nothing without summons on the board.
    targeting: { type: 'SELF', area: { shape: 'SQUARE', radius: 20, includeCenter: true } },
    effects: [
      { type: 'HEAL', amount: 2, to: 'SUMMONS' },
      { type: 'SHIELD', amount: 3, to: 'SUMMONS' },
      { type: 'SHIELD', amount: 2, to: 'CASTER' },
    ],
    ...set,
    presentation: { visualKey: 'pack_oath', element: 'SHIELD', castAnimation: 'cast_support', premiumTreatment: 'showcase' },
  },
  {
    id: 'judgement_hammer',
    name: 'Martillo del Juicio',
    heroId: 'warrior',
    cost: 3,
    category: 'ATTACK',
    tags: ['melee', 'push', 'guard', 'momentum', 'showcase'],
    rarity: 'RARE',
    rulesText:
      'Inflige 4 de daño físico a un enemigo adyacente, lo empuja 1 casilla (2 de daño si choca) y ganas 2 de Guardia. Impulso 2: lo consume; 5 de daño, lo empuja 2 casillas (3 si choca) y 3 de Guardia.',
    // Impact + staying power + push in one swing, for 3 of the Warrior's 4 energy. Golpe pesado
    // (3/5 for 1) stays the efficient hit; Golpe de la Forja (3 + push, cost 2) the cheap push.
    targeting: { type: 'UNIT', range: 1, unitFilter: 'ENEMY' },
    effects: [hit(4), { type: 'PUSH', distance: 1, collisionDamage: 2, to: 'ENEMIES' }, { type: 'SHIELD', amount: 2, to: 'CASTER' }],
    empowered: {
      momentum: 2,
      effects: [hit(5), { type: 'PUSH', distance: 2, collisionDamage: 3, to: 'ENEMIES' }, { type: 'SHIELD', amount: 3, to: 'CASTER' }],
    },
    ...set,
    presentation: { visualKey: 'judgement_hammer', element: 'FORCE', castAnimation: 'attack', premiumTreatment: 'showcase' },
  },
];
