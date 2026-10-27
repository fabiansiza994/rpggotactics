import type { CardDefinition } from '../domain/cards/card';

/**
 * Vínculo Prohibido (qa/forbidden-bond/REPORT.md): the Summoner pays half its current HP to hold
 * one more capacity point for the rest of the battle. LEGENDARY + Única (1 copy per deck,
 * banished once played, a second copy is refused), so it resolves at most once per battle.
 *
 * Its unlock source is NOT decided yet: the card ships in its own unreleased set, so no drop,
 * store pack, promo code or gift can hand it out (same gate as every QA set). Battles do not read
 * the set: a deck that holds it plays it normally (PvP and Ranked included).
 */
export const FORBIDDEN_BOND_EXPANSION = 'forbidden_bond';

export const FORBIDDEN_BOND: CardDefinition = {
  id: 'forbidden_bond',
  name: 'Vínculo Prohibido',
  heroId: 'summoner',
  cost: 2,
  rarity: 'LEGENDARY',
  unique: true,
  category: 'UTILITY',
  tags: ['ritual', 'sacrifice', 'summon-synergy', 'unique'],
  rulesText:
    'Única. Sacrifica la mitad de tu vida actual. Tu capacidad de invocación aumenta en 1 durante el resto del combate. No puede usarse con 1 PV.',
  // floor(HP / 2) can never kill: at 2 HP it takes 1, at 1 HP the card cannot be played.
  minCasterHp: 2,
  targeting: { type: 'SELF' },
  // Additive on purpose: base 2 → 3 today, a future base 3 (Mastery) → 4. Never set to a number.
  effects: [{ type: 'SACRIFICE_HP', percentOfCurrent: 50 }, { type: 'GAIN_SUMMON_CAPACITY', amount: 1 }],
  expansion: FORBIDDEN_BOND_EXPANSION,
  presentation: { cardType: 'ritual', visualKey: 'forbidden_bond', element: 'ARCANE', castAnimation: 'cast_support' },
};
