import type { CardDefinition } from '../domain/cards/card';

/**
 * «Arsenal I», the first variety expansion: 3 cards per champion + 3 neutral. Every card answers
 * "why this instead of an existing card?" with a role no current card covers; none out-scales the
 * card it sits next to (sidegrades, never same cost + more power). Balance probe, roles, packages
 * and the Codex visual contract: qa/card-expansion-01/REPORT.md.
 *
 * Rarity: 6 COMMON + 6 RARE (RARE = 1 copy per deck, existing rule). Three RARE are SHOWCASE
 * (`presentation.premiumTreatment`): premium art / frame / foil / VFX only, never more power,
 * never a different copy limit, drop rate, reward pool, price or PvP rule.
 *
 * Acquisition: the normal reward pools (no `acquisition`: never store-, promo-, gift- or
 * world-exclusive). Until the set is released (`GameContent.releasedExpansions`) it stays QA-only
 * like the other sets: guest QA builds with VITE_ARSENAL_CARDS=1 (`vite --mode arsenalqa`).
 * Battles, decks and PvP never read `expansion`.
 */
export const ARSENAL_EXPANSION = 'arsenal_01';

const MELEE = { type: 'UNIT', range: 1, unitFilter: 'ENEMY' } as const;
const set = { expansion: ARSENAL_EXPANSION } as const;

export const ARSENAL_MAGE_CARDS: CardDefinition[] = [
  {
    id: 'arcane_chain',
    name: 'Cadena Arcana',
    heroId: 'mage',
    cost: 2,
    category: 'CONTROL',
    tags: ['arcane', 'root', 'control'],
    rarity: 'COMMON',
    rulesText: 'Inflige 1 de daño arcano a un enemigo a distancia 4 con visión y lo enraíza 1 turno.',
    // Ranged single-target root: Frost Nova only roots what is touching you, Force Push moves
    // instead of pinning, Fireball burns. Probe (qa/card-expansion-01): with 2 damage it was
    // +7.0 / +8.8 pp for the Mage (failsafe); range 3 changed nothing, 1 damage → +4.2 / +7.6.
    targeting: { type: 'UNIT', range: 4, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [
      { type: 'DAMAGE', amount: 1, damageType: 'ARCANE', to: 'ENEMIES', attackKind: 'RANGED' },
      { type: 'APPLY_STATUS', status: 'ROOTED', duration: 1, to: 'ENEMIES' },
    ],
    ...set,
    presentation: { visualKey: 'arcane_chain', element: 'ARCANE', castAnimation: 'cast' },
  },
  {
    id: 'mirror_step',
    name: 'Paso Espejo',
    heroId: 'mage',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['movement', 'shield', 'illusion'],
    rarity: 'COMMON',
    rulesText:
      'Andas hasta 2 casillas sin gastar movimiento y ganas 2 de escudo hasta tu próximo turno. Deja una ilusión donde estabas. No funciona si estás Enraizado.',
    // A legal WALK (no obstacles, no root escape) where Blink teleports 3 and ignores both: Blink
    // escapes, Paso Espejo repositions safely. The illusion is visual only (no decoy unit).
    targeting: { type: 'STEP', range: 2 },
    effects: [{ type: 'STEP_CASTER' }, { type: 'SHIELD', amount: 2, to: 'CASTER' }],
    ...set,
    presentation: { visualKey: 'mirror_step', element: 'TELEPORT', castAnimation: 'blink' },
  },
  {
    id: 'silence_seal',
    name: 'Sello de Silencio',
    heroId: 'mage',
    cost: 2,
    category: 'CONTROL',
    tags: ['arcane', 'control', 'anti-special', 'showcase'],
    rarity: 'RARE',
    rulesText:
      'Sella a un enemigo a distancia 4 con visión durante su próximo turno: sus ataques infligen 2 menos (mínimo 1) y pierden sus efectos extra (empuje, quemadura, terreno).',
    // The first answer to an enemy's NEXT attack instead of its body: no damage, no movement
    // control. Never a full silence (minimum 1, one turn), so a boss still fights.
    targeting: { type: 'UNIT', range: 4, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [{ type: 'APPLY_STATUS', status: 'SEALED', duration: 1, to: 'ENEMIES' }],
    ...set,
    presentation: { visualKey: 'silence_seal', element: 'ARCANE', castAnimation: 'cast', premiumTreatment: 'showcase' },
  },
];

export const ARSENAL_SUMMONER_CARDS: CardDefinition[] = [
  {
    id: 'pack_call',
    name: 'Llamado de la Manada',
    heroId: 'summoner',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['summon-synergy', 'summon-command', 'movement'],
    rarity: 'COMMON',
    rulesText:
      'Tus invocaciones a 3 casillas o menos de ti ganan +1 de movimiento en su acción de este turno. Siguen actuando solas.',
    // Reach, not control: Azuzar shoves one summon, this lets the whole pack arrive (and reach a
    // Marcar Presa target it would otherwise miss). Never picks their attacks. Cost 1, not 2: the
    // probe bot almost never found a use at either cost (or with +2 move); human playtest decides.
    targeting: { type: 'SELF', area: { shape: 'SQUARE', radius: 3, includeCenter: false } },
    effects: [{ type: 'APPLY_STATUS', status: 'PACK_CALL', duration: 1, to: 'SUMMONS' }],
    ...set,
    presentation: { visualKey: 'pack_call', element: 'ARCANE', castAnimation: 'cast_support' },
  },
  {
    id: 'bond_sacrifice',
    name: 'Sacrificio del Vínculo',
    heroId: 'summoner',
    cost: 1,
    category: 'DEFENSE',
    tags: ['sacrifice', 'shield', 'bond'],
    rarity: 'RARE',
    rulesText:
      'Retira una invocación tuya a distancia 3: libera capacidad, ganas 5 de escudo hasta tu próximo turno y 1 energía.',
    // Ofrenda vital (heal 3) and Retorno ritual (energy + card) are the other conversions; this is
    // the emergency one. Net 0 energy and the summon is gone: no loop (re-summoning costs 2+).
    targeting: { type: 'UNIT', range: 3, unitFilter: 'SUMMON', requiresLineOfSight: true },
    effects: [
      { type: 'RECALL_SUMMON' },
      { type: 'SHIELD', amount: 5, to: 'CASTER' },
      { type: 'GAIN_ENERGY', amount: 1 },
    ],
    ...set,
    presentation: { visualKey: 'bond_sacrifice', element: 'SHIELD', castAnimation: 'cast_support' },
  },
  {
    id: 'alpha_instinct',
    name: 'Instinto Alfa',
    heroId: 'summoner',
    cost: 1,
    category: 'ATTACK',
    tags: ['summon-synergy', 'pressure', 'showcase'],
    rarity: 'RARE',
    rulesText:
      'Una invocación tuya a distancia 3 gana +1 de daño en su ataque de este turno, +2 si ataca a tu presa marcada. No se acumula.',
    // Manada Ancestral (ritual) is +2 to the whole army; this is one beast, and it pays off with
    // Marcar Presa. Every summon already prefers the prey it can reach: no extra control.
    // Cost 1, not 2: at 2 it was barely played (0.22 per game, −1 pp); same power, cheaper.
    targeting: { type: 'UNIT', range: 3, unitFilter: 'SUMMON', requiresLineOfSight: true },
    effects: [{ type: 'APPLY_STATUS', status: 'ALPHA_INSTINCT', duration: 1, to: 'SUMMONS' }],
    ...set,
    presentation: { visualKey: 'alpha_instinct', element: 'ARCANE', castAnimation: 'cast_quick', premiumTreatment: 'showcase' },
  },
];

export const ARSENAL_WARRIOR_CARDS: CardDefinition[] = [
  {
    id: 'challenge',
    name: 'Desafío',
    heroId: 'warrior',
    cost: 1,
    category: 'CONTROL',
    tags: ['guard', 'taunt', 'guardian'],
    rarity: 'RARE',
    rulesText:
      'Desafías a un enemigo a distancia 3 con visión durante su próximo turno: va a por ti si puede y sus ataques contra otros infligen 2 menos (mínimo 1). Ganas 2 de Guardia.',
    // The Warrior's only way to protect something else (a crystal, an ally, a summon in PvP):
    // enemies that ignore him now come to him. Guard is small so it never replaces Guardia.
    targeting: { type: 'UNIT', range: 3, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [
      { type: 'APPLY_STATUS', status: 'CHALLENGED', duration: 1, to: 'ENEMIES' },
      { type: 'SHIELD', amount: 2, to: 'CASTER' },
    ],
    ...set,
    presentation: { visualKey: 'challenge', element: 'FORCE', castAnimation: 'ability' },
  },
  {
    id: 'guard_breaker',
    name: 'Rompeguardia',
    heroId: 'warrior',
    cost: 2,
    category: 'ATTACK',
    tags: ['melee', 'anti-defense', 'showcase'],
    rarity: 'RARE',
    rulesText:
      'Rompe hasta 2 de escudo de un enemigo adyacente y luego le inflige 3 de daño físico que ignora la armadura.',
    // Golpe pesado hits harder (3, 5 with Impulso) for 1; this only wins against armor and shields
    // (Bruto, Coloso, Tortuga; Barrier / Guardia in PvP). The 2 extra never reaches HP.
    targeting: MELEE,
    effects: [{ type: 'DAMAGE', amount: 3, damageType: 'PHYSICAL', to: 'ENEMIES', attackKind: 'PIERCING', shieldBreak: 2 }],
    ...set,
    presentation: { visualKey: 'guard_breaker', element: 'FORCE', castAnimation: 'attack', premiumTreatment: 'showcase' },
  },
  {
    id: 'titan_step',
    name: 'Paso del Titán',
    heroId: 'warrior',
    cost: 2,
    category: 'MOVEMENT',
    tags: ['movement', 'guard', 'vanguard'],
    rarity: 'COMMON',
    rulesText:
      'Andas hasta 2 casillas sin gastar movimiento. Si terminas junto a un enemigo, ganas 2 de Guardia. El enganche da Impulso como siempre. No funciona si estás Enraizado.',
    // Carga needs a straight free lane and hits; this walks around corners and arrives guarded.
    // Momentum comes only from the normal engage rule (once per round): never a second trigger.
    targeting: { type: 'STEP', range: 2 },
    effects: [
      { type: 'STEP_CASTER' },
      { type: 'SHIELD', amount: 0, to: 'CASTER', bonus: { when: { type: 'CASTER_ADJACENT_TO_ENEMY' }, amount: 2 } },
    ],
    ...set,
    presentation: { visualKey: 'titan_step', element: 'FORCE', castAnimation: 'charge' },
  },
];

export const ARSENAL_NEUTRAL_CARDS: CardDefinition[] = [
  {
    id: 'smoke_bomb',
    name: 'Bomba de Humo',
    cost: 2,
    category: 'DEFENSE',
    tags: ['neutral', 'area', 'smoke'],
    rarity: 'RARE',
    rulesText:
      'Lanza humo en un área 3×3 a distancia 2: tú y tus aliados dentro reciben 1 menos de cada ataque enemigo hasta tu próximo turno.',
    // Per-hit reduction: worth more than a shield against many small hits and it covers summons
    // too. COVER terrain was not used: it only blunts RANGED card attacks, never enemy intents.
    targeting: { type: 'TILE', range: 2, tileFilter: 'NOT_BLOCKED', area: { shape: 'SQUARE', radius: 1, includeCenter: true } },
    effects: [{ type: 'APPLY_STATUS', status: 'SMOKE_SCREEN', duration: 1, to: 'ALLIES' }],
    ...set,
    presentation: { visualKey: 'smoke_bomb', element: 'NEUTRAL', castAnimation: 'cast_quick' },
  },
  {
    id: 'grappling_hook',
    name: 'Gancho',
    cost: 1,
    category: 'CONTROL',
    tags: ['neutral', 'pull'],
    rarity: 'COMMON',
    rulesText: 'Atrae 1 casilla hacia ti a un enemigo a distancia 3 con visión. No causa daño.',
    // The only pull: drag a caster into melee, off a crystal or onto fire. Pushes already move
    // every enemy (there is no immovable rule), so the hook follows the same rules.
    targeting: { type: 'UNIT', range: 3, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [{ type: 'PULL', distance: 1, to: 'ENEMIES' }],
    ...set,
    presentation: { visualKey: 'grappling_hook', element: 'FORCE', castAnimation: 'cast_push' },
  },
  {
    id: 'field_ration',
    name: 'Ración de Campaña',
    cost: 1,
    category: 'DEFENSE',
    tags: ['neutral', 'sustain', 'self'],
    rarity: 'COMMON',
    rulesText: 'Te curas 1 HP; 2 si tienes la mitad de tu vida o menos.',
    // The cheap top-up under Primeros auxilios (3 for 2): a 2/3 heal for 1 would have made it
    // irrelevant. Probe: heal 1/2 + draw 1 was +7.6 / +8.8 pp for the Mage (failsafe); without
    // the draw +2.4 / +3.6, below Primeros auxilios (+3.8 / +5.4).
    targeting: { type: 'SELF' },
    effects: [{ type: 'HEAL', amount: 1, to: 'CASTER', bonus: { when: { type: 'CASTER_HP_AT_MOST_HALF' }, amount: 1 } }],
    ...set,
    presentation: { visualKey: 'field_ration', element: 'SHIELD', castAnimation: 'cast_support' },
  },
];

export const ARSENAL_CARDS: CardDefinition[] = [
  ...ARSENAL_MAGE_CARDS,
  ...ARSENAL_SUMMONER_CARDS,
  ...ARSENAL_WARRIOR_CARDS,
  ...ARSENAL_NEUTRAL_CARDS,
];
