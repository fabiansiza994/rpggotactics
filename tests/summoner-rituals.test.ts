import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ASCENT_CAMPAIGN,
  DECK_RULES,
  DEFAULT_CONTENT,
  GameEngine,
  RITUAL_EXPANSION,
  RITUAL_TIER_PIECES,
  campaignBattleContent,
  cardFamily,
  copyLimit,
  createProfile,
  createRun,
  currentEncounter,
  parseCommand,
  replayBattle,
  ritualsUsingPiece,
  rollReward,
  validateDeck,
  verifyVictory,
  withPrototypeRituals,
  type Command,
  type DeckEntry,
  type GameContent,
  type GameEvent,
  type GameState,
  type PlayerProfile,
} from '../src/game';
import { actSummons, summonUsage } from '../src/game/domain/summons/summons';
import { dealDamage } from '../src/game/domain/combat/damage';
import { applyDuel, createDuel, duelEvents, duelView, type Loadout } from '../src/game/pvp/duel';
import { PvPMatchRoom, validCommand } from '../server/src/pvp';
import { releasedContent } from '../server/src/ritualRelease';
import { ctxFor, makeEngine, mutable, p, setHand, LEGEND } from './helpers';
import { memoryD1 } from './support/d1';
import { playBattle } from './support/bot';

const SUMMONER = { heroId: 'summoner', pos: p(0, 2) };
const PROTO = withPrototypeRituals(DEFAULT_CONTENT);
const engine = (content: GameContent = DEFAULT_CONTENT, overrides = {}) => makeEngine({ hero: SUMMONER, ...overrides }, content);
const altar = (e: GameEngine) => e.state.player.altar ?? [];
const setAltar = (e: GameEngine, cardIds: string[]) => {
  mutable(e).player.altar = cardIds.map((cardId, i) => ({ uid: `altar-${cardId}-${i}`, cardId }));
};
const summons = (e: GameEngine) => e.state.units.filter((u) => u.kind === 'SUMMON');
const error = (r: ReturnType<GameEngine['dispatch']>) => (r.ok ? 'OK' : r.error);
/** End the turn with the enemies stunned (these tests are about rituals, not survival). */
const nextTurn = (e: GameEngine) => {
  for (const u of e.state.units) if (u.faction === 'ENEMY') mutable(e).units.find((x) => x.id === u.id)!.statuses = [{ id: 'STUNNED', turnsLeft: 99 }];
  return e.dispatch({ type: 'END_TURN' });
};

describe('ritual content model', () => {
  const rituals = Object.values(PROTO.rituals!);

  it('defines generic rituals of every tier with distinct, valid pieces', () => {
    expect(new Set(rituals.map((r) => r.tier))).toEqual(new Set(['MINOR', 'MAJOR', 'LEGENDARY']));
    for (const r of rituals) {
      expect(r.pieces).toHaveLength(RITUAL_TIER_PIECES[r.tier]);
      expect(new Set(r.pieces).size).toBe(r.pieces.length);
      for (const id of r.pieces) {
        const card = PROTO.cards[id]!;
        expect(card.ritualPiece, id).toBe(true);
        expect(card.heroId).toBe(r.heroId);
        // A piece is never dead: it always has its own (weak) play.
        expect(card.effects.length, id).toBeGreaterThan(0);
        expect(card.cost, id).toBeLessThanOrEqual(1);
      }
      for (const fx of r.result.effects) if (fx.type === 'SUMMON') expect(PROTO.summons![fx.summonId], fx.summonId).toBeDefined();
      // Legendary pieces: 2 copies each (1 made the ritual ≈1% consistent; qa/primordial-dragon).
      if (r.tier === 'LEGENDARY') for (const id of r.pieces) expect(copyLimit(PROTO.cards[id]!, DECK_RULES)).toBe(2);
    }
  });

  it('Dragón Primordial is real content in its own unreleased set (never dropped until released)', () => {
    expect(DEFAULT_CONTENT.rituals!.primordial_dragon!.tier).toBe('LEGENDARY');
    expect(DEFAULT_CONTENT.summons!.primordial_dragon).toBeDefined();
    const seals = Object.values(DEFAULT_CONTENT.cards).filter((c) => c.id.startsWith('seal_'));
    expect(seals.map((c) => c.expansion)).toEqual(Array(4).fill('summoner_primordial'));
    expect(DEFAULT_CONTENT.releasedExpansions ?? []).not.toContain('summoner_primordial');
    expect(Object.values(DEFAULT_CONTENT.rituals!).map((r) => r.tier).sort()).toEqual(['LEGENDARY', 'MAJOR', 'MINOR']);
  });

  it('ritual = creature: every ritual (prototype included) summons one creature, no team buffs', () => {
    for (const r of rituals) {
      expect(r.result.kind, r.id).toBe('SUMMON_CREATURE');
      expect(r.result.effects.filter((fx) => fx.type === 'SUMMON'), r.id).toHaveLength(1);
    }
    expect(DEFAULT_CONTENT.rituals!.ancestral_pack).toBeUndefined();
    // Tiers: minor → strong creature, major → elite, legendary → legendary (bigger each step).
    const body = (id: string) => PROTO.summons![(PROTO.rituals![id]!.result.effects.find((fx) => fx.type === 'SUMMON') as { summonId: string }).summonId]!;
    expect(body('ancestral_wolf').damage).toBeGreaterThan(body('ancestral_shell').damage);
    expect(body('primordial_dragon').maxHp).toBeGreaterThan(body('ancestral_wolf').maxHp);
    // Every tier takes the whole capacity and replaces current summons (no stacking, no stuck altar).
    for (const r of rituals) expect(r.dismissSummons, r.id).toBe(true);
    expect(body('ancestral_wolf').capacityCost).toBe(DEFAULT_CONTENT.heroes.summoner!.summonCapacity);
    // The Lobo Ancestral out-classes the direct Lobo; Dragón de Guerra stays a direct summon.
    expect(body('ancestral_wolf').damage).toBeGreaterThan(DEFAULT_CONTENT.summons!.wolf!.damage);
    expect(DEFAULT_CONTENT.cards.summon_war_drake!.ritualPiece).toBeUndefined();
    expect(ritualsUsingPiece(DEFAULT_CONTENT, 'summon_war_drake')).toEqual([]);
  });

  it('Manada Ancestral is now an ordinary support card (not a ritual, not a piece)', () => {
    const card = DEFAULT_CONTENT.cards.ancestral_pack!;
    expect(card).toMatchObject({ heroId: 'summoner', cost: 2, rarity: 'RARE', expansion: RITUAL_EXPANSION });
    expect(card.ritualPiece).toBeUndefined();
    expect(cardFamily(card)).toBe('SUPPORT');
  });

  it('marks the expansion and never puts it in a starter deck', () => {
    const expansion = Object.values(DEFAULT_CONTENT.cards).filter((c) => c.expansion === RITUAL_EXPANSION).map((c) => c.id);
    expect(expansion.sort()).toEqual(['ancestral_pack', 'mark_blood', 'mark_fang', 'mark_moon', 'rune_shell', 'rune_stone', 'summon_war_drake']);
    for (const hero of Object.values(DEFAULT_CONTENT.heroes))
      for (const e of hero.deck) expect(DEFAULT_CONTENT.cards[e.cardId]!.expansion, e.cardId).toBeUndefined();
  });

  it('derives deck-building families and "part of" data', () => {
    expect(cardFamily(DEFAULT_CONTENT.cards.summon_wolf!)).toBe('SUMMON');
    expect(cardFamily(DEFAULT_CONTENT.cards.summon_war_drake!)).toBe('SUMMON');
    expect(cardFamily(DEFAULT_CONTENT.cards.rune_stone!)).toBe('RITUAL_PIECE');
    expect(cardFamily(DEFAULT_CONTENT.cards.entangle!)).toBe('CONTROL');
    expect(cardFamily(DEFAULT_CONTENT.cards.nurture!)).toBe('SUPPORT');
    expect(ritualsUsingPiece(DEFAULT_CONTENT, 'mark_fang').map((r) => r.id)).toEqual(['ancestral_wolf']);
    expect(ritualsUsingPiece(DEFAULT_CONTENT, 'summon_wolf')).toEqual([]);
  });
});

describe('altar (ritual preparation)', () => {
  it('first seal of the turn is free; the second, third and fourth cost 1 energy each', () => {
    const e = engine(PROTO);
    mutable(e).player.energy = 4;
    const uids = setHand(e, ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart']);
    expect(e.getAltarStatus()).toMatchObject({ sealsThisTurn: 0, nextSealCost: 0 });
    const paid: number[] = [];
    for (const uid of uids) {
      const before = e.state.player.energy;
      const r = e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: uid! });
      expect(r.ok).toBe(true);
      paid.push(before - e.state.player.energy);
      expect(r.ok && r.events.find((ev) => ev.type === 'RITUAL_PIECE_COMMITTED')).toMatchObject({ cardUid: uid, energyCost: paid.at(-1) });
    }
    expect(paid).toEqual([0, 1, 1, 1]);
    expect(altar(e).map((c) => c.cardId)).toEqual(['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart']);
    expect(e.state.player.hand).toEqual([]);
    expect(e.state.player).toMatchObject({ energy: 1, altarSeals: 4 });
    expect(e.getAltarStatus()).toMatchObject({ sealsThisTurn: 4, nextSealCost: 1, used: 4, slots: 4 });
  });

  it('a paid seal needs the energy; nothing changes when it is rejected; the price resets each turn', () => {
    const e = engine();
    const [stone, shell] = setHand(e, ['rune_stone', 'rune_shell']);
    expect(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: stone! }).ok).toBe(true);
    mutable(e).player.energy = 0;
    const before = structuredClone(e.state);
    expect(error(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: shell! }))).toBe('NOT_ENOUGH_ENERGY');
    expect(e.state).toEqual(before);
    expect(e.getCommitPlayability(shell!)).toMatchObject({ playable: false, reason: 'NOT_ENOUGH_ENERGY' });
    nextTurn(e);
    expect(e.getAltarStatus()).toMatchObject({ sealsThisTurn: 0, nextSealCost: 0 });
    const energy = e.state.player.energy;
    expect(error(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: shell! }))).toBe('OK');
    expect(e.state.player.energy).toBe(energy); // first seal of the new turn: free again
    expect(altar(e).map((c) => c.cardId)).toEqual(['rune_stone', 'rune_shell']);
  });

  it('the sealing price is champion data (altarSealing)', () => {
    const free2: GameContent = { ...DEFAULT_CONTENT, heroes: { ...DEFAULT_CONTENT.heroes, summoner: { ...DEFAULT_CONTENT.heroes.summoner!, altarSealing: { freePerTurn: 2, extraEnergy: 2 } } } };
    const e = engine(withPrototypeRituals(free2));
    mutable(e).player.energy = 4;
    const uids = setHand(e, ['seal_claw', 'seal_fang', 'seal_wing']);
    for (const uid of uids) e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: uid! });
    expect(e.state.player.energy).toBe(2);
  });

  it('rejects duplicates, non-pieces, cards not in hand and a full altar', () => {
    const e = engine();
    setAltar(e, ['rune_stone']);
    const [dup, wolf] = setHand(e, ['rune_stone', 'summon_wolf']);
    expect(error(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: dup! }))).toBe('ALTAR_DUPLICATE');
    expect(error(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: wolf! }))).toBe('NOT_A_RITUAL_PIECE');
    expect(error(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: 'altar-rune_stone-0' }))).toBe('CARD_NOT_IN_HAND');
    setAltar(e, ['rune_shell', 'mark_moon', 'mark_fang', 'mark_blood']);
    expect(error(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: dup! }))).toBe('ALTAR_FULL');
  });

  it('a champion without an altar cannot seal pieces', () => {
    const noAltar: GameContent = { ...DEFAULT_CONTENT, heroes: { ...DEFAULT_CONTENT.heroes, summoner: { ...DEFAULT_CONTENT.heroes.summoner!, altarSlots: undefined } } };
    const e = engine(noAltar);
    expect(e.state.player.altar).toBeUndefined();
    const [stone] = setHand(e, ['rune_stone']);
    expect(error(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: stone! }))).toBe('NO_ALTAR');
    // Other champions keep their battle state free of ritual fields.
    expect(makeEngine().state.player).not.toHaveProperty('altar');
  });

  it('releasing a piece sends it to the discard pile, never back to the hand', () => {
    const e = engine();
    setAltar(e, ['rune_stone']);
    expect(e.dispatch({ type: 'RELEASE_RITUAL_PIECE', cardUid: 'altar-rune_stone-0' }).ok).toBe(true);
    expect(altar(e)).toEqual([]);
    expect(e.state.player.discard.at(-1)).toEqual({ uid: 'altar-rune_stone-0', cardId: 'rune_stone' });
    expect(e.state.player.hand.some((c) => c.cardId === 'rune_stone')).toBe(false);
    expect(error(e.dispatch({ type: 'RELEASE_RITUAL_PIECE', cardUid: 'altar-rune_stone-0' }))).toBe('PIECE_NOT_ON_ALTAR');
  });

  it('assembles a 4-piece ritual with a 4-card hand by sealing over several turns (free seals only)', () => {
    const e = engine(PROTO);
    for (const [turn, id] of ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart'].entries()) {
      const [uid] = setHand(e, [id, 'nurture', 'summoner_ward', 'summoner_step']);
      expect(e.state.player.hand.length).toBeLessThanOrEqual(e.state.player.maxHandSize);
      expect(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: uid! }).ok, `turn ${turn}`).toBe(true);
      if (turn < 3) {
        expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: p(1, 2) }))).toBe('RITUAL_INCOMPLETE');
        nextTurn(e);
      }
    }
    expect(e.getRitualProgress().find((r) => r.ritual.id === 'primordial_dragon')).toMatchObject({ complete: true, missing: [] });
    expect(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: p(1, 2) }).ok).toBe(true);
    expect(summons(e).map((u) => u.defId)).toEqual(['primordial_dragon']);
  });
});

describe('ritual activation (server-side rules)', () => {
  it('missing piece: cannot activate and nothing changes', () => {
    const e = engine();
    setAltar(e, ['rune_stone']);
    const before = structuredClone(e.state);
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(1, 2) }))).toBe('RITUAL_INCOMPLETE');
    expect(e.state).toEqual(before);
    expect(e.getCardPlayability('ritual:ancestral_shell')).toMatchObject({ playable: false, reason: 'RITUAL_INCOMPLETE' });
  });

  it('minor ritual: consumes both pieces, pays energy and summons the Tortuga Ancestral', () => {
    const e = engine();
    setAltar(e, ['rune_stone', 'rune_shell']);
    const energy = e.state.player.energy;
    expect(e.getValidTargets('ritual:ancestral_shell')).toContainEqual(p(1, 2));
    const r = e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(1, 2) });
    expect(r.ok).toBe(true);
    const turtle = summons(e)[0]!;
    expect(turtle).toMatchObject({ defId: 'ancient_turtle', hp: 22, armor: 1, faction: 'PLAYER', pos: p(1, 2) });
    expect(turtle.summon).toMatchObject({ ownerId: 'summoner', capacityCost: 2 });
    expect(e.state.units.find((u) => u.id === 'summoner')!.shield).toBe(3);
    expect(e.state.player.energy).toBe(energy - 2);
    expect(altar(e)).toEqual([]);
    expect(e.state.player.discard.map((c) => c.cardId)).toEqual(['rune_stone', 'rune_shell']);
    const types = r.ok ? r.events.map((ev) => ev.type) : [];
    expect(types.indexOf('RITUAL_ACTIVATED')).toBeLessThan(types.indexOf('UNIT_SPAWNED'));
    expect(types.at(-1)).toBe('RITUAL_RESOLVED');
    expect(e.state.player.ritualsResolved).toEqual(['ancestral_shell']);
  });

  it('a duplicate of one piece does not satisfy the other', () => {
    const e = engine();
    mutable(e).player.altar = [
      { uid: 'a', cardId: 'rune_stone' },
      { uid: 'b', cardId: 'rune_stone' },
    ];
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(1, 2) }))).toBe('RITUAL_INCOMPLETE');
  });

  it('consumed pieces cannot be reused', () => {
    const e = engine();
    setAltar(e, ['rune_stone', 'rune_shell']);
    expect(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(1, 2) }).ok).toBe(true);
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(1, 3) }))).toBe('RITUAL_INCOMPLETE');
    expect(error(e.dispatch({ type: 'RELEASE_RITUAL_PIECE', cardUid: 'altar-rune_stone-0' }))).toBe('PIECE_NOT_ON_ALTAR');
    expect(error(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: 'altar-rune_stone-0' }))).toBe('CARD_NOT_IN_HAND');
  });

  it('validates capacity, energy, target tile and terrain', () => {
    const e = engine(DEFAULT_CONTENT, { layout: ['.......', '.......', '.v.....', '.......', '.......'], legend: { ...LEGEND, v: { terrain: 'VOID' } } });
    setAltar(e, ['rune_stone', 'rune_shell']);
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(1, 2) }))).toBe('INVALID_TARGET'); // VOID
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(0, 2) }))).toBe('INVALID_TARGET'); // occupied (hero)
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(5, 2) }))).toBe('INVALID_TARGET'); // out of range
    expect(e.getValidTargets('ritual:ancestral_shell')).not.toContainEqual(p(1, 2));
    mutable(e).player.energy = 0;
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(0, 3) }))).toBe('NOT_ENOUGH_ENERGY');
    mutable(e).player.energy = 4;
    // The Tortuga Ancestral takes the whole capacity: a familiar on the board is dismissed
    // (never stacked, never blocking a complete altar).
    const [chicken] = setHand(e, ['summon_chicken']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: chicken!, target: p(0, 1) }).ok).toBe(true);
    expect(e.getAltarStatus()!.rituals.find((r) => r.ritualId === 'ancestral_shell')).toMatchObject({ ready: true, replacesSummons: true });
    expect(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(0, 3) }).ok).toBe(true);
    expect(summons(e).map((u) => u.defId)).toEqual(['ancient_turtle']);
    expect(summonUsage(e.state, 'summoner')).toBe(2);
  });

  it('a capacity check still applies to non-replacing rituals (generic rule)', () => {
    const keep: GameContent = { ...DEFAULT_CONTENT, rituals: { ...DEFAULT_CONTENT.rituals, ancestral_shell: { ...DEFAULT_CONTENT.rituals!.ancestral_shell!, dismissSummons: false } } };
    const e = engine(keep);
    setAltar(e, ['rune_stone', 'rune_shell']);
    const [chicken] = setHand(e, ['summon_chicken']);
    e.dispatch({ type: 'PLAY_CARD', cardUid: chicken!, target: p(0, 1) });
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(0, 3) }))).toBe('SUMMON_CAPACITY');
    expect(e.getAltarStatus()!.rituals.find((r) => r.ritualId === 'ancestral_shell')).toMatchObject({ complete: true, ready: false, blockedBy: { code: 'SUMMON_CAPACITY' } });
    expect(altar(e)).toHaveLength(2); // nothing consumed by a rejected activation
  });

  it('major ritual: three marks → Lobo Ancestral, replacing the current summons (whole capacity)', () => {
    const e = engine();
    const [chicken, fox] = setHand(e, ['summon_chicken', 'summon_fox']);
    e.dispatch({ type: 'PLAY_CARD', cardUid: chicken!, target: p(1, 2) });
    e.dispatch({ type: 'PLAY_CARD', cardUid: fox!, target: p(0, 1) });
    expect(summonUsage(e.state, 'summoner')).toBe(2);
    mutable(e).player.energy = 2;
    setAltar(e, ['mark_moon', 'mark_fang']);
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_wolf', target: p(0, 3) }))).toBe('RITUAL_INCOMPLETE');
    expect(e.getAltarStatus()!.rituals.find((r) => r.ritualId === 'ancestral_wolf')).toMatchObject({ required: 3, sealedCount: 2, complete: false, ready: false });
    setAltar(e, ['mark_moon', 'mark_fang', 'mark_blood']);
    expect(e.getAltarStatus()!.rituals.find((r) => r.ritualId === 'ancestral_wolf')).toMatchObject({ sealedCount: 3, complete: true, ready: true, replacesSummons: true });
    const r = e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_wolf', target: p(0, 3) });
    expect(r.ok).toBe(true);
    expect(summons(e).map((u) => u.defId)).toEqual(['ancient_wolf']);
    expect(summons(e)[0]).toMatchObject({ hp: 20, armor: 0, pos: p(0, 3), summon: { ownerId: 'summoner', capacityCost: 2 } });
    expect(summonUsage(e.state, 'summoner')).toBe(2);
    expect(e.state.player.energy).toBe(0);
    expect(altar(e)).toEqual([]);
    expect(e.state.player.discard.map((c) => c.cardId)).toEqual(['summon_chicken', 'summon_fox', 'mark_moon', 'mark_fang', 'mark_blood']);
    // No limit per battle (pieces only come back through a reshuffle).
    expect(e.state.player.ritualsResolved).toEqual(['ancestral_wolf']);
  });

  it('Manada Ancestral (support card): heals the summons and grants Fury for this turn', () => {
    const e = engine();
    const [chicken, fox, pack] = setHand(e, ['summon_chicken', 'summon_fox', 'ancestral_pack']);
    e.dispatch({ type: 'PLAY_CARD', cardUid: chicken!, target: p(1, 2) });
    e.dispatch({ type: 'PLAY_CARD', cardUid: fox!, target: p(0, 1) });
    for (const u of summons(e)) u.hp -= 3;
    mutable(e).player.energy = 2;
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: pack!, target: null }).ok).toBe(true);
    expect(e.state.player.energy).toBe(0);
    for (const u of summons(e)) {
      expect(u.hp).toBe(u.maxHp - 1);
      expect(u.shield).toBe(0);
      expect(u.statuses).toContainEqual({ id: 'PACK_FURY', turnsLeft: 1 });
    }
    // Fury: the fox's automatic attack deals 2 + 2.
    const fox2 = summons(e).find((u) => u.defId === 'fox')!;
    mutable(e).units = e.state.units.filter((u) => u.faction === 'PLAYER');
    mutable(e).units.push({ ...structuredClone(fox2), id: 'dummy', kind: 'ENEMY', faction: 'ENEMY', summon: undefined, pos: p(fox2.pos.x + 1, fox2.pos.y), hp: 20, maxHp: 20, shield: 0, statuses: [], armor: 0 });
    mutable(e).round = 5;
    const events: GameEvent[] = [];
    actSummons(ctxFor(e, events), 'summoner');
    const hit = events.find((ev) => ev.type === 'UNIT_DAMAGED' && ev.sourceId === fox2.id);
    expect(hit).toMatchObject({ rawAmount: 4 });
  });

  it('legendary prototype: sacrifices current summons, takes full capacity, once per battle', () => {
    const e = engine(PROTO);
    const [wolf] = setHand(e, ['summon_wolf']);
    e.dispatch({ type: 'PLAY_CARD', cardUid: wolf!, target: p(1, 2) });
    mutable(e).player.energy = 3;
    setAltar(e, ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart']);
    const r = e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: p(0, 3) });
    expect(r.ok).toBe(true);
    expect(summons(e).map((u) => u.defId)).toEqual(['primordial_dragon']);
    expect(summonUsage(e.state, 'summoner')).toBe(2);
    setAltar(e, ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart']);
    mutable(e).player.energy = 3;
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: p(0, 1) }))).toBe('RITUAL_LIMIT');
  });

  it('rejects unknown, inherited and wrong-class ritual ids', () => {
    const e = engine();
    setAltar(e, ['rune_stone', 'rune_shell']);
    for (const ritualId of ['nope', '__proto__', 'constructor', 'toString'])
      expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId, target: p(1, 2) })), ritualId).toBe('UNKNOWN_RITUAL');
    const mage = makeEngine();
    expect(error(mage.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(1, 2) }))).toBe('WRONG_CLASS');
  });

  it('pieces keep their secondary play (and it is a normal card play)', () => {
    const e = engine();
    const [blood] = setHand(e, ['mark_blood']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: blood!, target: null }).ok).toBe(true);
    expect(e.state.units.find((u) => u.id === 'summoner')!.shield).toBe(1);
    expect(e.state.player.discard.map((c) => c.cardId)).toEqual(['mark_blood']);
  });
});

describe('advanced direct summon — Dragón de Guerra', () => {
  const drake = (e: GameEngine, target = p(1, 2)) => {
    const [uid] = setHand(e, ['summon_war_drake']);
    return e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
  };

  it('costs the whole turn of energy and the whole capacity', () => {
    const e = engine();
    mutable(e).player.energy = 3;
    expect(error(drake(e))).toBe('NOT_ENOUGH_ENERGY');
    mutable(e).player.energy = 4;
    const [chicken] = setHand(e, ['summon_chicken']);
    e.dispatch({ type: 'PLAY_CARD', cardUid: chicken!, target: p(0, 1) });
    mutable(e).player.energy = 4;
    expect(error(drake(e))).toBe('SUMMON_CAPACITY');
    mutable(e).units = e.state.units.filter((u) => u.kind !== 'SUMMON');
    expect(drake(e).ok).toBe(true);
    expect(e.state.player.energy).toBe(0);
    expect(summons(e)[0]).toMatchObject({ defId: 'war_drake', hp: 18, faction: 'PLAYER', summon: { ownerId: 'summoner', capacityCost: 2, readyRound: 2 } });
  });

  it('needs an empty, walkable tile (occupied / VOID rejected)', () => {
    const e = engine(DEFAULT_CONTENT, { layout: ['.......', '.......', '.v.....', '.......', '.......'], legend: { ...LEGEND, v: { terrain: 'VOID' } } });
    expect(error(drake(e, p(1, 2)))).toBe('INVALID_TARGET');
    expect(error(drake(e, p(0, 2)))).toBe('INVALID_TARGET');
    expect(drake(e, p(0, 1)).ok).toBe(true);
  });

  it('breathes fire at range 2 and dies like any summon, freeing capacity', () => {
    const e = engine(DEFAULT_CONTENT, { enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) }] });
    drake(e);
    mutable(e).round = 2;
    const events: GameEvent[] = [];
    actSummons(ctxFor(e, events));
    const hit = events.find((ev) => ev.type === 'UNIT_DAMAGED' && ev.unitId === 'orc-1');
    expect(hit).toMatchObject({ damageType: 'FIRE', rawAmount: 3 });
    const unitDrake = summons(e)[0]!;
    dealDamage(ctxFor(e), unitDrake, 99, 'orc-1', 'PHYSICAL');
    expect(summons(e)).toEqual([]);
    expect(summonUsage(e.state, 'summoner')).toBe(0);
  });

  it('is a valid PvP target for the rival champion', () => {
    const loadouts: [Loadout, Loadout] = [
      { heroId: 'summoner', cards: DEFAULT_CONTENT.heroes.summoner!.deck },
      { heroId: 'mage', cards: DEFAULT_CONTENT.heroes.mage!.deck },
    ];
    let s = createDuel(loadouts, 3);
    if (s.duel!.active !== 0) s = applyDuel(s, { type: 'END_TURN' }).state;
    const hero = s.units.find((u) => u.id === 'champion-a')!;
    s.player.hand[0] = { uid: 'drake', cardId: 'summon_war_drake' };
    s.player.energy = 4;
    const tile = [p(hero.pos.x + 1, hero.pos.y), p(hero.pos.x, hero.pos.y + 1)].find((t) => !s.units.some((u) => u.pos.x === t.x && u.pos.y === t.y))!;
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'drake', target: tile }).state;
    s = applyDuel(s, { type: 'END_TURN' }).state;
    // Now the Mage acts: move it next to the drake's lane and aim a Magic Missile.
    s.player.hand[0] = { uid: 'mm', cardId: 'magic_missile' };
    const drakeUnit = s.units.find((u) => u.defId === 'war_drake')!;
    expect(drakeUnit.summon?.ownerId).toBe('champion-a');
    s.units.find((u) => u.id === 'champion-b')!.pos = p(drakeUnit.pos.x + 2, drakeUnit.pos.y);
    const engineB = GameEngine.fromSnapshot(s, DEFAULT_CONTENT, makeEngine().scenario);
    expect(engineB.getValidTargets('mm')).toContainEqual(drakeUnit.pos);
  });
});

describe('rewards and release switch', () => {
  const owned = () => 0;
  const roll = (content: GameContent, seed: number) =>
    rollReward({ content, heroId: 'summoner', owned, pity: 4, rules: DECK_RULES, poolId: 'BOSS', seed, count: 3 });

  it('never offers the QA-only set until it is released, then it drops normally', () => {
    const released = { ...DEFAULT_CONTENT, releasedExpansions: [...(DEFAULT_CONTENT.releasedExpansions ?? []), RITUAL_EXPANSION] };
    const offered = (content: GameContent) =>
      new Set(Array.from({ length: 200 }, (_, i) => roll(content, i + 1).options.flatMap((o) => (o.kind === 'ADD_CARD' ? [o.cardId] : [])))
        .flat());
    const locked = offered(DEFAULT_CONTENT);
    expect([...locked].filter((id) => DEFAULT_CONTENT.cards[id]!.expansion === RITUAL_EXPANSION)).toEqual([]);
    expect([...locked].every(id => !DEFAULT_CONTENT.cards[id]!.expansion || DEFAULT_CONTENT.releasedExpansions?.includes(DEFAULT_CONTENT.cards[id]!.expansion!))).toBe(true);
    const open = offered(released);
    expect(['summon_war_drake', 'rune_stone', 'mark_moon'].every((id) => open.has(id))).toBe(true);
  });

  it('server switch only adds the set to reward content', () => {
    expect(releasedContent(DEFAULT_CONTENT, { DB: null as never })).toBe(DEFAULT_CONTENT);
    expect(releasedContent(DEFAULT_CONTENT, { DB: null as never, SUMMONER_RITUALS_ENABLED: '1' }).releasedExpansions).toEqual([...(DEFAULT_CONTENT.releasedExpansions ?? []), RITUAL_EXPANSION]);
  });

  it('ritual pieces cost real deck slots and respect copy limits', () => {
    const deck: DeckEntry[] = [...DEFAULT_CONTENT.heroes.summoner!.deck.filter((e) => e.cardId !== 'summon_fox'), { cardId: 'rune_stone', count: 2 }, { cardId: 'rune_shell', count: 1 }];
    const all = () => 9;
    expect(validateDeck(deck, 'summoner', all, DEFAULT_CONTENT, DECK_RULES)).toEqual([]);
    const tooMany = [...deck.filter((e) => e.cardId !== 'rune_shell'), { cardId: 'rune_shell', count: 3 }];
    expect(validateDeck(tooMany, 'summoner', all, DEFAULT_CONTENT, DECK_RULES).map((i) => i.code)).toContain('COPY_LIMIT');
    expect(validateDeck(deck, 'mage', all, DEFAULT_CONTENT, DECK_RULES).map((i) => i.code)).toContain('WRONG_HERO');
  });
});

// ── PvP ─────────────────────────────────────────────────────────────────────────────────────

const RITUAL_DECK: DeckEntry[] = [
  { cardId: 'summon_chicken', count: 3 },
  { cardId: 'summon_fox', count: 3 },
  { cardId: 'nurture', count: 2 },
  { cardId: 'summoner_ward', count: 2 },
  { cardId: 'rune_stone', count: 2 },
  { cardId: 'rune_shell', count: 2 },
  { cardId: 'mark_moon', count: 2 },
  { cardId: 'mark_fang', count: 2 },
  { cardId: 'mark_blood', count: 2 },
  { cardId: 'summoner_step', count: 3 },
  { cardId: 'summoner_blink', count: 3 },
  { cardId: 'summoner_dispel', count: 2 },
  { cardId: 'entangle', count: 2 },
];

/** Summoner mirror with the active seat holding ritual pieces in hand. */
function ritualDuel(seed = 5) {
  // Starter decks (no pieces anywhere) + pieces injected into the active hand: any piece id in a
  // serialized view can then only come from the committer.
  const starter = DEFAULT_CONTENT.heroes.summoner!.deck;
  const s = createDuel([{ heroId: 'summoner', cards: starter }, { heroId: 'summoner', cards: starter }], seed);
  s.player.hand = [
    { uid: 'secret-stone', cardId: 'rune_stone' },
    { uid: 'secret-shell', cardId: 'rune_shell' },
  ];
  return s;
}

describe('PvP hidden ritual information', () => {
  it('the rival sees only the altar size, never piece identities', () => {
    let s = ritualDuel();
    const seat = s.duel!.active;
    const rival = (1 - seat) as 0 | 1;
    const applied = applyDuel(s, { type: 'COMMIT_RITUAL_PIECE', cardUid: 'secret-stone' });
    s = applied.state;
    const theirs = JSON.stringify({ game: duelView(s, rival), events: duelEvents(s, rival, applied.events) });
    expect(theirs).not.toContain('rune_stone');
    expect(theirs).not.toContain('rune_shell');
    expect(theirs).not.toContain('secret-');
    expect(duelView(s, rival).pileCounts.opponentAltar).toBe(1);
    expect(duelEvents(s, rival, applied.events).find((e) => e.type === 'RITUAL_PIECE_COMMITTED')).toEqual({
      type: 'RITUAL_PIECE_COMMITTED',
      casterId: s.duel!.champions[seat],
      altarSize: 1,
      energyCost: 0,
    });
    const mine = duelView(s, seat);
    expect(mine.player.altar).toEqual([{ uid: 'secret-stone', cardId: 'rune_stone' }]);
    expect(duelEvents(s, seat, applied.events).find((e) => e.type === 'RITUAL_PIECE_COMMITTED')).toMatchObject({ cardId: 'rune_stone' });
    // Still hidden after the turn passes to the rival (the altar travels with its owner).
    s = applyDuel(s, { type: 'END_TURN' }).state;
    expect(JSON.stringify(duelView(s, rival))).not.toContain('rune_stone');
    expect(duelView(s, rival).pileCounts.opponentAltar).toBe(1);
    expect(duelView(s, seat).player.altar).toHaveLength(1);
  });

  it('several seals in one turn: priced by the server, identities still hidden', () => {
    let s = ritualDuel();
    const seat = s.duel!.active;
    const rival = (1 - seat) as 0 | 1;
    s.player.energy = 1;
    const first = applyDuel(s, { type: 'COMMIT_RITUAL_PIECE', cardUid: 'secret-stone' });
    const second = applyDuel(first.state, { type: 'COMMIT_RITUAL_PIECE', cardUid: 'secret-shell' });
    s = second.state;
    expect(s.player.energy).toBe(0);
    expect(s.player.altar!.map((c) => c.cardId)).toEqual(['rune_stone', 'rune_shell']);
    const theirs = JSON.stringify({ game: duelView(s, rival), events: [...duelEvents(first.state, rival, first.events), ...duelEvents(s, rival, second.events)] });
    for (const leak of ['rune_stone', 'rune_shell', 'secret-']) expect(theirs).not.toContain(leak);
    expect(duelEvents(s, rival, second.events).find((e) => e.type === 'RITUAL_PIECE_COMMITTED')).toEqual({
      type: 'RITUAL_PIECE_COMMITTED',
      casterId: s.duel!.champions[seat],
      altarSize: 2,
      energyCost: 1,
    });
    expect(duelView(s, rival).pileCounts.opponentAltar).toBe(2);
    // A third seal without energy is refused by the rules (the duel throws the rule error).
    s.player.hand = [{ uid: 'secret-moon', cardId: 'mark_moon' }];
    expect(() => applyDuel(s, { type: 'COMMIT_RITUAL_PIECE', cardUid: 'secret-moon' })).toThrow('NOT_ENOUGH_ENERGY');
    // The price resets for the owner's next turn, not the rival's.
    s = applyDuel(applyDuel(s, { type: 'END_TURN' }).state, { type: 'END_TURN' }).state;
    expect(s.duel!.active).toBe(seat);
    expect(s.player.altarSeals).toBe(0);
  });

  it("the opponent's sealed pieces never count for you", () => {
    let s = ritualDuel();
    s.player.altar = [
      { uid: 'x1', cardId: 'rune_stone' },
      { uid: 'x2', cardId: 'rune_shell' },
    ];
    s = applyDuel(s, { type: 'END_TURN' }).state;
    expect(s.duel!.other.altar).toHaveLength(2);
    const hero = s.units.find((u) => u.id === s.player.heroId)!;
    expect(() => applyDuel(s, { type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: p(hero.pos.x, hero.pos.y + 1) })).toThrow('RITUAL_INCOMPLETE');
    expect(() => applyDuel(s, { type: 'RELEASE_RITUAL_PIECE', cardUid: 'x1' })).toThrow('PIECE_NOT_ON_ALTAR');
  });

  it('the server command validator only accepts well-formed ritual commands', () => {
    expect(validCommand({ type: 'COMMIT_RITUAL_PIECE', cardUid: 'card-1' })).toBe(true);
    expect(validCommand({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: { x: 1, y: 2 } })).toBe(true);
    expect(validCommand({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: null })).toBe(true);
    expect(validCommand({ type: 'ACTIVATE_RITUAL', ritualId: 5, target: null })).toBe(false);
    expect(validCommand({ type: 'ACTIVATE_RITUAL', ritualId: 'x'.repeat(200), target: null })).toBe(false);
    expect(validCommand({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: { x: 1.5, y: 2 } })).toBe(false);
    expect(validCommand({ type: 'COMMIT_RITUAL_PIECE' })).toBe(false);
    expect(validCommand({ type: 'COMPLETE_RITUAL', ritualId: 'ancestral_shell' })).toBe(false);
  });
});

/** Minimal Durable Object harness (same shape as tests/pvp.test.ts) with a Summoner mirror. */
function roomHarness() {
  const db = memoryD1({ legacyProfiles: true });
  for (const m of ['0004_pvp.sql', '0005_pvp_dominion.sql', '0006_pvp_maps.sql', '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql'])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${m}`, import.meta.url), 'utf8'));
  const data = new Map<string, unknown>();
  const sockets: FakeSocket[] = [];
  let init = Promise.resolve();
  const ctx = {
    storage: {
      get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined,
      put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
    blockConcurrencyWhile: <T,>(fn: () => Promise<T>) => {
      const pr = fn();
      init = pr.then(() => {});
      return pr;
    },
    acceptWebSocket: () => {},
    getWebSockets: (tag?: string) => sockets.filter((s) => !s.closed && (tag === undefined || s.seat === Number(tag))),
  };
  // Starter decks: the only ritual piece in the match is the one the test injects.
  const loadout: Loadout = { heroId: 'summoner', cards: DEFAULT_CONTENT.heroes.summoner!.deck };
  const boot = async () => {
    const room = new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], { DB: db });
    await init;
    return room;
  };
  const post = (room: PvPMatchRoom, path: string, id: number) =>
    room.fetch(
      new Request('https://room/' + path, {
        method: 'POST',
        headers: { 'X-Pvp-User': String(id), 'X-Pvp-Name': 'QA' + id },
        body: JSON.stringify({ code: 'ABCDEFGH', mode: 'DUEL', mapId: 'classic', loadout }),
      }),
    );
  return { data, sockets, boot, post };
}
class FakeSocket {
  messages: string[] = [];
  closed = false;
  constructor(public seat: number) {}
  deserializeAttachment() {
    return { seat: this.seat };
  }
  serializeAttachment() {}
  send(s: string) {
    this.messages.push(s);
  }
  close() {
    this.closed = true;
  }
}
const ws = (s: FakeSocket) => s as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0];

describe('PvP room: rituals through the authoritative server', () => {
  it('commits (free + paid) are hidden from the rival, idempotent on retry, survive reconnect; duplicates and forged activations fail', async () => {
    const h = roomHarness();
    let room = await h.boot();
    await h.post(room, 'create', 1);
    await h.post(room, 'join', 2);
    const a = new FakeSocket(0), b = new FakeSocket(1);
    h.sockets.push(a, b);
    (h.data.get('room') as { members: { offlineAt: number | null }[] }).members.forEach((m) => (m.offlineAt = null));
    room = await h.boot();
    await h.post(room, 'ready', 1);
    await h.post(room, 'ready', 2);
    const stored = h.data.get('room') as { game: GameState; version: number };
    const seat = stored.game.duel!.active;
    const me = seat === 0 ? a : b, rival = seat === 0 ? b : a;
    stored.game.player.hand[0] = { uid: 'secret-stone', cardId: 'rune_stone' };
    room = await h.boot(); // storage is the source of truth (as after an eviction)

    const action = { id: 'seal-1', version: stored.version, command: { type: 'COMMIT_RITUAL_PIECE', cardUid: 'secret-stone' } };
    await room.webSocketMessage(ws(me), JSON.stringify(action));
    const after = h.data.get('room') as typeof stored;
    expect(after.game.player.altar).toEqual([{ uid: 'secret-stone', cardId: 'rune_stone' }]);
    const rivalSnapshot = rival.messages.at(-1)!;
    expect(rivalSnapshot).not.toContain('rune_stone');
    expect(rivalSnapshot).not.toContain('secret-stone');
    expect(JSON.parse(rivalSnapshot).game.pileCounts.opponentAltar).toBe(1);

    // Exact retry: acknowledged, not applied twice.
    await room.webSocketMessage(ws(me), JSON.stringify(action));
    expect((h.data.get('room') as typeof stored).version).toBe(after.version);
    expect((h.data.get('room') as typeof stored).game.player.altar).toHaveLength(1);

    // Second seal in the same turn: the server charges 1 energy; a duplicate piece is refused.
    const live = h.data.get('room') as typeof stored;
    live.game.player.hand = [{ uid: 'secret-shell', cardId: 'rune_shell' }, { uid: 'dup-stone', cardId: 'rune_stone' }];
    const energy = live.game.player.energy;
    room = await h.boot();
    await room.webSocketMessage(ws(me), JSON.stringify({ id: 'seal-2', version: live.version, command: { type: 'COMMIT_RITUAL_PIECE', cardUid: 'secret-shell' } }));
    const two = h.data.get('room') as typeof stored;
    expect(two.game.player.altar!.map((c) => c.cardId)).toEqual(['rune_stone', 'rune_shell']);
    expect(two.game.player.energy).toBe(energy - 1);
    expect(rival.messages.at(-1)).not.toContain('rune_shell');
    await room.webSocketMessage(ws(me), JSON.stringify({ id: 'seal-dup', version: two.version, command: { type: 'COMMIT_RITUAL_PIECE', cardUid: 'dup-stone' } }));
    expect(me.messages.at(-1)).toContain('ALTAR_DUPLICATE');
    expect((h.data.get('room') as typeof stored).game.player.altar).toHaveLength(2);

    // Reconnect: a fresh instance restores the altar for its owner and only the count for the rival.
    room = await h.boot();
    await room.webSocketMessage(ws(me), JSON.stringify({ type: 'resync' }));
    await room.webSocketMessage(ws(rival), JSON.stringify({ type: 'resync' }));
    expect(JSON.parse(me.messages.at(-1)!).game.player.altar).toEqual([{ uid: 'secret-stone', cardId: 'rune_stone' }, { uid: 'secret-shell', cardId: 'rune_shell' }]);
    expect(JSON.parse(me.messages.at(-1)!).game.player.altarSeals).toBe(2);
    expect(rival.messages.at(-1)).not.toContain('rune_stone');
    expect(rival.messages.at(-1)).not.toContain('rune_shell');
    expect(JSON.parse(rival.messages.at(-1)!).game.pileCounts.opponentAltar).toBe(2);

    // Forged: the Lobo Ancestral with no marks sealed, plus forged result/piece fields.
    const version = (h.data.get('room') as typeof stored).version;
    await room.webSocketMessage(
      ws(me),
      JSON.stringify({ id: 'forge', version, command: { type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_wolf', target: { x: 1, y: 1 }, summonId: 'primordial_dragon', pieces: ['mark_moon', 'mark_fang', 'mark_blood'] } }),
    );
    expect(me.messages.at(-1)).toContain('RITUAL_INCOMPLETE');
    await room.webSocketMessage(ws(rival), JSON.stringify({ id: 'steal', version, command: { type: 'RELEASE_RITUAL_PIECE', cardUid: 'secret-stone' } }));
    expect(rival.messages.at(-1)).toContain('NOT_YOUR_TURN');
    expect((h.data.get('room') as typeof stored).game.player.altar).toHaveLength(2);
  });
});

// ── Campaign / replay ───────────────────────────────────────────────────────────────────────

function ritualProfile(): PlayerProfile {
  const profile = createProfile(DEFAULT_CONTENT);
  const hero = profile.heroes.summoner!;
  for (const e of RITUAL_DECK) hero.collection[e.cardId] = { copies: Math.max(e.count, hero.collection[e.cardId]?.copies ?? 0), acquired: 1 };
  hero.decks = [{ id: 'main', name: 'Rituales', cards: RITUAL_DECK.map((e) => ({ ...e })) }];
  return profile;
}

describe('campaign + replay determinism', () => {
  it('parses ritual commands from untrusted proofs', () => {
    expect(parseCommand({ type: 'COMMIT_RITUAL_PIECE', cardUid: 'card-3', extra: 1 })).toEqual({ type: 'COMMIT_RITUAL_PIECE', cardUid: 'card-3' });
    expect(parseCommand({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_wolf', target: null })).toEqual({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_wolf', target: null });
    expect(parseCommand({ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_wolf' })).toBeNull();
    expect(parseCommand({ type: 'RELEASE_RITUAL_PIECE', cardUid: 3 })).toBeNull();
  });

  it('a campaign victory with ritual setup (incl. multi-seal turns) + activation replays and verifies exactly', () => {
    const profile = ritualProfile();
    const results: { seed: number; won: boolean; rituals: number; multiSealTurns: number }[] = [];
    let verified = 0;
    for (let seed = 1; seed <= 12 && (verified < 2 || !results.some((r) => r.multiSealTurns > 0)); seed++) {
      const run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, seed, 'summoner');
      const content = campaignBattleContent(DEFAULT_CONTENT, profile, run, DECK_RULES);
      expect(content.heroes.summoner!.deck).toEqual(RITUAL_DECK); // the ritual deck is the legal battle deck
      const e = new GameEngine(currentEncounter(ASCENT_CAMPAIGN, run), content, seed);
      playBattle(e, 20, undefined, { summonAware: true, rituals: true });
      const rituals = e.history.filter((c: Command) => c.type === 'ACTIVATE_RITUAL').length;
      // Turns with 2+ seals (the paid ones): split the history at END_TURN.
      const turns = e.history.reduce<Command[][]>((acc, c) => (c.type === 'END_TURN' ? [...acc, []] : (acc.at(-1)!.push(c), acc)), [[]]);
      const multiSealTurns = turns.filter((t) => t.filter((c) => c.type === 'COMMIT_RITUAL_PIECE').length >= 2).length;
      results.push({ seed, won: e.state.outcome?.result === 'WON', rituals, multiSealTurns });
      const replay = replayBattle(currentEncounter(ASCENT_CAMPAIGN, run), content, seed, e.history);
      expect(replay.rejectedAt).toBeNull();
      expect(replay.state).toEqual(e.state);
      if (e.state.outcome?.result === 'WON' && rituals > 0) {
        const proof = JSON.parse(JSON.stringify({ encounterId: run.currentEncounterId, seed, commands: e.history }));
        expect(verifyVictory(ASCENT_CAMPAIGN, DEFAULT_CONTENT, profile, run, proof, DECK_RULES)).toEqual({ ok: true });
        verified++;
      }
    }
    expect(verified, JSON.stringify(results)).toBeGreaterThan(0);
    // Multi-seal turns are part of what replays identically (asserted for every battle above).
    expect(results.some((r) => r.multiSealTurns > 0), JSON.stringify(results)).toBe(true);
  }, 120_000);

  it('a tampered proof (ritual activated without its pieces) is rejected', () => {
    const profile = ritualProfile();
    const run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 1, 'summoner');
    const proof = { encounterId: run.currentEncounterId, seed: 1, commands: [{ type: 'ACTIVATE_RITUAL', ritualId: 'ancestral_shell', target: { x: 1, y: 1 } }] };
    expect(verifyVictory(ASCENT_CAMPAIGN, DEFAULT_CONTENT, profile, run, proof, DECK_RULES)).toEqual({ ok: false, error: 'a command was rejected by the rules' });
  });
});
