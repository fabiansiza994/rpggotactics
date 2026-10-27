import { PRIMORDIAL_LEGACY_CARDS } from './primordial-legacy';
/** Initial 30-card class catalog. Private QA registration only; no public release. */
import type { GameContent } from '../domain/content';
import type { CardDefinition, EffectDef, TargetingDef } from '../domain/cards/card';
import type { DeckEntry } from '../collection/deck-rules';
import { withShapeshifter2dQa } from './shapeshifter-2d-qa';
export type ShapeshifterGroup = 'universal' | 'bear' | 'minotaur' | 'transformation';
const self: TargetingDef = { type: 'SELF' };
const melee: TargetingDef = { type: 'UNIT', range: 1, unitFilter: 'ENEMY' };
const ring: TargetingDef = {
  type: 'SELF',
  area: { shape: 'CROSS', radius: 1, includeCenter: false },
};
const damage = (amount: number): EffectDef => ({
  type: 'DAMAGE',
  amount,
  damageType: 'PHYSICAL',
  to: 'ENEMIES',
});
const shield = (amount: number): EffectDef => ({ type: 'SHIELD', amount, to: 'CASTER' });
const heal = (amount: number): EffectDef => ({ type: 'HEAL', amount, to: 'CASTER' });
const move = (amount: number): EffectDef => ({ type: 'GAIN_MOVE_POINTS', amount });
const status = (
  id: 'ROOTED' | 'SEALED' | 'RIPOSTE' | 'SMOKE_SCREEN' | 'CHALLENGED',
  to: 'CASTER' | 'ENEMIES',
  duration = 1,
): EffectDef => ({ type: 'APPLY_STATUS', status: id, duration, to });
const definitions: { group: ShapeshifterGroup; card: CardDefinition }[] = [];
function add(
  group: ShapeshifterGroup,
  id: string,
  name: string,
  cost: number,
  category: CardDefinition['category'],
  text: string,
  targeting: TargetingDef,
  effects: EffectDef[],
) {
  definitions.push({
    group,
    card: {
      id,
      name,
      cost,
      category,
      heroId: 'shapeshifter',
      rarity: 'COMMON',
      expansion: 'shapeshifter_private_qa',
      tags: ['shapeshifter-catalog', group],
      rulesText: text,
      targeting,
      effects,
      requiredForms: group === 'bear' ? ['bear'] : group === 'minotaur' ? ['minotaur'] : undefined,
      presentation: { visualKey: id, element: category === 'DEFENSE' ? 'SHIELD' : 'FORCE' },
    },
  });
}
// Eight form-neutral class cards; NOT shared neutral ownership and NOT cards for other heroes.
add(
  'universal',
  'qa_mend_spirit',
  'Recomponer el Espíritu',
  2,
  'DEFENSE',
  'Recupera 3 HP. No supera la vida máxima.',
  self,
  [heal(3)],
);
add(
  'universal',
  'qa_ancestral_trace',
  'Rastro Ancestral',
  1,
  'CONTROL',
  'Inflige 1 de daño y aplica Enraizado durante 1 turno a un enemigo a alcance 2.',
  { type: 'UNIT', range: 2, unitFilter: 'ENEMY', requiresLineOfSight: true },
  [damage(1), status('ROOTED', 'ENEMIES')],
);
add(
  'universal',
  'qa_wild_vigor',
  'Vigor Salvaje',
  1,
  'MOVEMENT',
  'Gana 1 de escudo y recupera 2 puntos de movimiento.',
  self,
  [shield(1), move(2)],
);
add(
  'universal',
  'qa_shed_curse',
  'Mudar la Maldición',
  1,
  'UTILITY',
  'Elimina todos tus estados negativos. No cambia tu forma.',
  self,
  [{ type: 'CLEANSE', to: 'CASTER' }],
);
// Seven additions plus the existing claw/roar = nine Bear cards.
add(
  'bear',
  'qa_bear_maul',
  'Abrazo Aplastante',
  2,
  'ATTACK',
  'Oso: inflige 3 de daño adyacente y gana 2 de escudo.',
  melee,
  [damage(3), shield(2)],
);
add(
  'bear',
  'qa_bear_roots',
  'Raíces del Guardián',
  1,
  'CONTROL',
  'Oso: enraíza a los enemigos ortogonalmente adyacentes durante 1 turno.',
  ring,
  [status('ROOTED', 'ENEMIES')],
);
add(
  'bear',
  'qa_bear_recovery',
  'Reposo Ancestral',
  2,
  'DEFENSE',
  'Oso: recupera 3 HP y gana 1 de escudo.',
  self,
  [heal(3), shield(1)],
);
add(
  'bear',
  'qa_bear_counter',
  'Garra Vigilante',
  1,
  'DEFENSE',
  'Oso: gana 1 de escudo y Contraataque hasta tu siguiente turno.',
  self,
  [shield(1), status('RIPOSTE', 'CASTER')],
);
add('bear', 'qa_bear_guard', 'Bastión de Pelaje', 2, 'DEFENSE', 'Oso: gana 6 de escudo.', self, [
  shield(6),
]);
add(
  'bear',
  'qa_bear_lure',
  'Desafío del Guardián',
  1,
  'CONTROL',
  'Oso: desafía a un enemigo a alcance 2 durante 1 turno y gana 2 de escudo.',
  { type: 'UNIT', range: 2, unitFilter: 'ENEMY', requiresLineOfSight: true },
  [status('CHALLENGED', 'ENEMIES'), shield(2)],
);
add(
  'bear',
  'qa_bear_shove',
  'Zarpazo de Despeje',
  1,
  'CONTROL',
  'Oso: empuja 2 casillas a un enemigo adyacente; colisión: 1 de daño.',
  melee,
  [{ type: 'PUSH', distance: 2, collisionDamage: 1, to: 'ENEMIES' }],
);
// Seven additions plus existing charge/sweep = nine Minotaur cards.
add(
  'minotaur',
  'qa_horn_strike',
  'Golpe de Cuernos',
  1,
  'ATTACK',
  'Minotauro: inflige 3 de daño físico adyacente.',
  melee,
  [damage(3)],
);
add(
  'minotaur',
  'qa_iron_cleave',
  'Hendidura de Hierro',
  2,
  'ATTACK',
  'Minotauro: inflige 3 de daño adyacente ignorando armadura. El escudo sí protege.',
  melee,
  [
    {
      ...damage(3),
      type: 'DAMAGE',
      amount: 3,
      damageType: 'PHYSICAL',
      to: 'ENEMIES',
      attackKind: 'PIERCING',
    },
  ],
);
add(
  'minotaur',
  'qa_broken_guard',
  'Quebrar la Guardia',
  2,
  'ATTACK',
  'Minotauro: retira hasta 3 de escudo e inflige 2 de daño adyacente.',
  melee,
  [{ type: 'DAMAGE', amount: 2, damageType: 'PHYSICAL', to: 'ENEMIES', shieldBreak: 3 }],
);
add(
  'minotaur',
  'qa_blood_stride',
  'Paso del Asedio',
  1,
  'MOVEMENT',
  'Minotauro: avanza hasta 3 casillas caminables sin gastar movimiento.',
  { type: 'STEP', range: 3 },
  [{ type: 'STEP_CASTER' }],
);
add(
  'minotaur',
  'qa_horn_pull',
  'Enganche de Cuerno',
  1,
  'CONTROL',
  'Minotauro: atrae 1 casilla a un enemigo a alcance 2. Sin daño de colisión.',
  { type: 'UNIT', range: 2, unitFilter: 'ENEMY', requiresLineOfSight: true },
  [{ type: 'PULL', distance: 1, to: 'ENEMIES' }],
);
add(
  'minotaur',
  'qa_iron_wake',
  'Estela de Acero',
  2,
  'ATTACK',
  'Minotauro: inflige 2 de daño a enemigos ortogonalmente adyacentes y recupera 1 movimiento.',
  ring,
  [damage(2), move(1)],
);
add(
  'minotaur',
  'qa_war_breath',
  'Aliento de Batalla',
  1,
  'UTILITY',
  'Minotauro: gana 2 de escudo y roba 1 carta.',
  self,
  [shield(2), { type: 'DRAW', count: 1 }],
);
// Two transformations already exist. These two synergies work in either beast form.
add(
  'transformation',
  'qa_form_memory',
  'Memoria de la Bestia',
  1,
  'UTILITY',
  'Oso o Minotauro: roba 1 carta y recupera 1 movimiento.',
  self,
  [{ type: 'DRAW', count: 1 }, move(1)],
);
add(
  'transformation',
  'qa_ancestral_link',
  'Continuidad Ancestral',
  1,
  'MOVEMENT',
  'Oso o Minotauro: recupera 1 movimiento y gana 2 de escudo.',
  self,
  [move(1), shield(2)],
);
const oldGroups: Record<string, ShapeshifterGroup> = {
  qa_bear_form: 'transformation',
  qa_minotaur_form: 'transformation',
  qa_primal_instinct: 'universal',
  qa_wild_strike: 'universal',
  qa_hunter_step: 'universal',
  qa_bark_skin: 'universal',
  qa_bear_claw: 'bear',
  qa_protective_roar: 'bear',
  qa_brutal_charge: 'minotaur',
  qa_axe_sweep: 'minotaur',
};
const entry = (id: string, count: number): DeckEntry => ({ cardId: id, count });
export const SHAPESHIFTER_STARTER: DeckEntry[] = [
  entry('qa_bear_form', 3),
  entry('qa_minotaur_form', 3),
  entry('qa_primal_instinct', 3),
  entry('qa_wild_strike', 3),
  entry('qa_hunter_step', 2),
  entry('qa_bark_skin', 2),
  entry('qa_bear_claw', 2),
  entry('qa_protective_roar', 2),
  entry('qa_brutal_charge', 2),
  entry('qa_axe_sweep', 2),
  entry('qa_form_memory', 2),
  entry('qa_ancestral_link', 2),
  entry('qa_mend_spirit', 2),
];
const emphasis = (ids: string[]): DeckEntry[] => [
  entry('qa_bear_form', 3),
  entry('qa_minotaur_form', 3),
  ...ids.map((id) => entry(id, 3)),
];
export const SHAPESHIFTER_CATALOG_DECKS = {
  hybrid: SHAPESHIFTER_STARTER,
  bear: emphasis([
    'qa_wild_strike',
    'qa_primal_instinct',
    'qa_bear_claw',
    'qa_protective_roar',
    'qa_bear_maul',
    'qa_bear_recovery',
    'qa_bear_counter',
    'qa_form_memory',
  ]),
  minotaur: emphasis([
    'qa_wild_strike',
    'qa_primal_instinct',
    'qa_brutal_charge',
    'qa_axe_sweep',
    'qa_horn_strike',
    'qa_iron_cleave',
    'qa_blood_stride',
    'qa_form_memory',
  ]),
};
export function shapeshifterCatalog(base: GameContent): GameContent {
  const content = withShapeshifter2dQa(base);
  const reused = Object.values(content.cards)
    .filter((c) => c.heroId === 'shapeshifter')
    .map((c) => ({
      ...c,
      maxCopies: undefined,
      tags: ['shapeshifter-catalog', oldGroups[c.id]!],
      rulesText: c.rulesText.replace(/^QA provisional(?: 2D)?: /, ''),
      ...(c.id === 'qa_hunter_step'
        ? { cost: 1, rulesText: 'Camina hasta 2 casillas caminables sin gastar movimiento.' }
        : {}),
    }));
  const added = definitions.map(({ card }) =>
    card.id === 'qa_form_memory' || card.id === 'qa_ancestral_link'
      ? { ...card, requiredForms: ['bear', 'minotaur'] }
      : card,
  );
  const cards = [...reused, ...added, ...PRIMORDIAL_LEGACY_CARDS];
  return {
    ...content,
    cards: { ...content.cards, ...Object.fromEntries(cards.map((c) => [c.id, c])) },
    heroes: {
      ...content.heroes,
      shapeshifter: {
        ...content.heroes.shapeshifter!,
        deck: SHAPESHIFTER_STARTER,
        starterCollection: cards.map((c) => entry(c.id, 3)),
      },
    },
  };
}
export const shapeshifterCardGroup = (card: CardDefinition): ShapeshifterGroup | undefined =>
  card.tags?.find((t) => ['universal', 'bear', 'minotaur', 'transformation'].includes(t)) as
    ShapeshifterGroup | undefined;
export const shapeshifterArtPending = (id: string): boolean =>
  id.startsWith('qa_') && !['qa_bear_form', 'qa_minotaur_form'].includes(id);
