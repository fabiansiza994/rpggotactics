import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, DECK_RULES, rollReward, withHeroDeck, type GameEvent, type GameState } from '../src/game';
import { withArcher, ARCHER_HERO } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import {
  RANKED_CARD_REWARD_ID,
  RANKED_CORE_CARDS,
  RANKED_TRACK_CARDS,
} from '../src/game/data/ranked-cards';
import { UNLEASHED_HUNT } from '../src/game/data/unleashed-hunt';
import { copyLimit } from '../src/game/collection/deck-rules';
import { isExclusiveCard } from '../src/game/domain/cards/card';
import { dealDamage } from '../src/game/domain/combat/damage';
import { pushUnit } from '../src/game/domain/combat/movement';
import { placeTrap } from '../src/game/domain/combat/traps';
import { applyStatus } from '../src/game/domain/statuses/status-rules';
import { spawnSummon } from '../src/game/domain/summons/summons';
import { replayBattle } from '../src/game/engine/replay';
import type { Command } from '../src/game/engine/commands';
import { applyDuel, createDuel, duelEvents, duelView } from '../src/game/pvp/duel';
import { discardSearchChoices } from '../src/game/domain/cards/play-card';
import { validCommand } from '../server/src/pvp';
import type { ScenarioDef } from '../src/game/domain/scenario';
import { LEGEND, ctxFor, makeEngine, mutable, ofType, p, scenario, setHand, unit } from './helpers';

const ARCHER = withArcher(DEFAULT_CONTENT);
const SHIFTER = withShapeshifterRelease(DEFAULT_CONTENT);
const LEGEND_C: ScenarioDef['legend'] = { ...LEGEND, C: { terrain: 'COVER' } };
const ORC = (id: string, x: number, y: number) => ({ id, enemyId: 'orc_warrior', pos: p(x, y) });

function battle(heroId: string, heroPos: { x: number; y: number }, enemies: ReturnType<typeof ORC>[], content = DEFAULT_CONTENT, overrides: Partial<ScenarioDef> = {}) {
  const e = makeEngine({ hero: { heroId, pos: heroPos }, enemies, ...overrides }, content);
  mutable(e).player.energy = 9;
  return e;
}
const hero = (e: ReturnType<typeof battle>) => unit(e, e.heroId);
const play = (e: ReturnType<typeof battle>, cardId: string, target: { x: number; y: number } | null) => {
  const [uid] = setHand(e, [cardId]);
  return e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
};
const targets = (e: ReturnType<typeof battle>, cardId: string) => e.getValidTargets(setHand(e, [cardId])[0]!);
const keyOf = (q: { x: number; y: number }) => `${q.x},${q.y}`;
const markPrey = (e: ReturnType<typeof battle>, id: string) => unit(e, id).statuses.push({ id: 'PREY', turnsLeft: 1, sourceId: e.heroId });
const endTurn = (e: ReturnType<typeof battle>) => {
  const events: GameEvent[] = [];
  const off = e.subscribe((evs) => events.push(...evs));
  const r = e.dispatch(e.state.player.hand.length > (e.state.player.handSize ?? 5)
    ? { type: 'END_TURN', discardUid: e.state.player.hand.at(-1)!.uid } : { type: 'END_TURN' });
  off();
  expect(r.ok).toBe(true);
  return events;
};
const summon = (e: ReturnType<typeof battle>, summonId: string, pos: { x: number; y: number }) => {
  const s = spawnSummon(ctxFor(e), hero(e), summonId, pos);
  if (!s) throw new Error('spawn failed');
  return s;
};

describe('Ranked cards: catalog', () => {
  it('nine approved cards: 2 Mage, 2 Invocador, 2 Guerrero, 2 Arquero, 1 Cambiaformas; 6 UNCOMMON + 3 RARE', () => {
    expect(RANKED_TRACK_CARDS.map((c) => c.id).sort()).toEqual(Object.keys(RANKED_CARD_REWARD_ID).sort());
    const by = (h: string) => RANKED_TRACK_CARDS.filter((c) => c.heroId === h).length;
    expect([by('mage'), by('summoner'), by('warrior'), by('archer'), by('shapeshifter')]).toEqual([2, 2, 2, 2, 1]);
    expect(RANKED_TRACK_CARDS.filter((c) => c.rarity === 'UNCOMMON').map((c) => c.id).sort()).toEqual(
      ['altar_echo', 'ignition_rune', 'pact_relay', 'palisade', 'wall_patience', 'wild_burst'],
    );
    expect(RANKED_TRACK_CARDS.filter((c) => c.rarity === 'RARE').map((c) => c.id).sort()).toEqual(['arcane_exchange', 'siege_leap', 'tracking_arrow']);
    const cost = Object.fromEntries(RANKED_TRACK_CARDS.map((c) => [c.id, c.cost]));
    expect(cost).toEqual({ palisade: 1, wall_patience: 1, pact_relay: 1, wild_burst: 1, ignition_rune: 2, altar_echo: 1, siege_leap: 2, tracking_arrow: 2, arcane_exchange: 1 });
  });

  it('copy limits are the normal ladder: UNCOMMON ×2, RARE ×1 (no maxCopies override)', () => {
    for (const c of RANKED_TRACK_CARDS) {
      expect(c.maxCopies).toBeUndefined();
      expect(copyLimit(c, DECK_RULES)).toBe(c.rarity === 'RARE' ? 1 : 2);
    }
  });

  it('early access: acquisition RANKED_TRACK (preseason_0, stable reward id) → never dropped', () => {
    for (const c of RANKED_TRACK_CARDS) {
      expect(c.acquisition).toEqual({ source: 'RANKED_TRACK', seasonId: 'preseason_0', rewardId: RANKED_CARD_REWARD_ID[c.id as keyof typeof RANKED_CARD_REWARD_ID] });
      expect(isExclusiveCard(c)).toBe(true);
    }
    for (const heroId of ['mage', 'summoner', 'warrior'])
      for (let seed = 1; seed <= 40; seed++) {
        const offer = rollReward({ heroId, content: DEFAULT_CONTENT, rules: DECK_RULES, owned: () => 0, seed, pity: 10, poolId: seed % 2 ? 'BOSS' : 'ELITE', count: 3 });
        const ids = JSON.stringify(offer);
        for (const c of RANKED_CORE_CARDS) expect(ids).not.toContain(`"${c.id}"`);
      }
  });

  it('registered where their champion lives; Cambiaformas card never joins its starter collection', () => {
    for (const c of RANKED_CORE_CARDS) expect(DEFAULT_CONTENT.cards[c.id]).toBe(c);
    expect(ARCHER.cards.palisade?.heroId).toBe('archer');
    expect(ARCHER.cards.tracking_arrow?.heroId).toBe('archer');
    expect(DEFAULT_CONTENT.cards.palisade).toBeUndefined();
    expect(SHIFTER.cards.wild_burst?.heroId).toBe('shapeshifter');
    expect(SHIFTER.heroes.shapeshifter!.starterCollection!.some((e) => e.cardId === 'wild_burst')).toBe(false);
    expect(ARCHER_HERO.deck.some((e) => e.cardId === 'palisade')).toBe(false);
  });

  it('Cacería Desatada is untouched: no acquisition, still RARE ×1, not on the track', () => {
    expect(UNLEASHED_HUNT.acquisition).toBeUndefined();
    expect(UNLEASHED_HUNT.rarity).toBe('RARE');
    expect(RANKED_TRACK_CARDS.some((c) => c.id === 'unleashed_hunt')).toBe(false);
  });
});

describe('Empalizada (Arquero)', () => {
  const archer = (enemies = [ORC('orc-1', 4, 2)]) => battle('archer', p(0, 2), enemies, ARCHER);

  it('targets only free adjacent tiles; costs 1; Escombros for 2 rounds block walking, not sight', () => {
    const e = archer();
    expect(targets(e, 'palisade').map(keyOf).sort()).toEqual(['0,1', '0,3', '1,2']);
    expect(play(e, 'palisade', p(2, 2)).ok).toBe(false);
    const before = e.state.player.energy;
    expect(play(e, 'palisade', p(1, 2)).ok).toBe(true);
    expect(e.state.player.energy).toBe(before - 1);
    expect(e.state.obstacles.find((o) => o.pos.x === 1 && o.pos.y === 2)).toMatchObject({ defId: 'rubble', turnsLeft: 2 });
    // Sight is kept: the basic shot still reaches the orc behind the palisade line.
    expect(targets(e, 'archer_shot').map(keyOf)).toContain('4,2');
  });

  it('+1 Concentración only when the Presa is at Distancia Óptima', () => {
    const near = archer([ORC('orc-1', 2, 2)]);
    markPrey(near, 'orc-1');
    play(near, 'palisade', p(0, 1));
    expect(hero(near).focus!.value).toBe(0);
    const optimal = archer([ORC('orc-1', 3, 2)]);
    markPrey(optimal, 'orc-1');
    play(optimal, 'palisade', p(0, 1));
    expect(hero(optimal).focus!.value).toBe(1);
  });

  it('counterplay: a push into the palisade is a collision (damage); it expires after 2 rounds', () => {
    const e = archer([ORC('orc-1', 5, 2)]);
    play(e, 'palisade', p(1, 2));
    const events: GameEvent[] = [];
    mutable(e).units.find((u) => u.id === 'archer')!.pos = p(2, 2);
    pushUnit(ctxFor(e, events), hero(e), 'LEFT', 2, 2, 'orc-1');
    expect(ofType(events, 'UNIT_PUSHED')[0]).toMatchObject({ collision: 'OBSTACLE', to: p(2, 2) });
    expect(hero(e).hp).toBe(16);
    endTurn(e);
    endTurn(e);
    expect(e.state.obstacles.some((o) => o.defId === 'rubble')).toBe(false);
  });
});

describe('Paciencia del Muro (Guerrero) — once per turn', () => {
  const warrior = () => battle('warrior', p(0, 2), [ORC('orc-1', 4, 2), ORC('orc-2', 1, 2)]);
  const status = (e: ReturnType<typeof battle>) => hero(e).statuses.find((s) => s.id === 'WALL_PATIENCE');

  it('3 Guardia, loses the remaining movement, status until the next own turn', () => {
    const e = warrior();
    expect(play(e, 'wall_patience', null).ok).toBe(true);
    expect(hero(e).shield).toBe(3);
    expect(e.state.player.movePoints).toBe(0);
    expect(status(e)).toBeDefined();
  });

  it('first ranged hit of the turn: +2 (normal +1 + Paciencia); later ranged hits that turn: only +1; melee never triggers it', () => {
    const e = warrior();
    play(e, 'wall_patience', null);
    hero(e).momentum!.value = 0;
    const ctx = ctxFor(e);
    dealDamage(ctx, hero(e), 1, 'orc-2', 'PHYSICAL'); // adjacent: normal +1 only
    expect(hero(e).momentum!.value).toBe(1);
    hero(e).momentum!.value = 0;
    dealDamage(ctx, hero(e), 1, 'orc-1', 'PHYSICAL', 'RANGED'); // absorbed by Guardia: still lands
    expect(hero(e).momentum!.value).toBe(2);
    dealDamage(ctx, hero(e), 1, 'orc-1', 'PHYSICAL', 'RANGED');
    expect(hero(e).momentum!.value).toBe(3); // +1 normal only
    hero(e).momentum!.value = 0;
    dealDamage(ctx, hero(e), 1, 'orc-1', 'PHYSICAL', 'RANGED');
    expect(hero(e).momentum!.value).toBe(1);
  });

  it('a new turn makes the bonus available again (engine turn key: round + side)', () => {
    const e = warrior();
    play(e, 'wall_patience', null);
    hero(e).momentum!.value = 0;
    dealDamage(ctxFor(e), hero(e), 1, 'orc-1', 'PHYSICAL', 'RANGED'); // own turn
    expect(hero(e).momentum!.value).toBe(2);
    mutable(e).activeFaction = 'ENEMY'; // the enemy turn of the same round
    hero(e).momentum!.value = 0;
    dealDamage(ctxFor(e), hero(e), 1, 'orc-1', 'PHYSICAL', 'RANGED');
    expect(hero(e).momentum!.value).toBe(2);
  });

  it('cap 3 respected; not attacking gives nothing; the status ends at the next own turn start', () => {
    const e = warrior();
    play(e, 'wall_patience', null);
    hero(e).momentum!.value = 2;
    dealDamage(ctxFor(e), hero(e), 1, 'orc-1', 'PHYSICAL', 'RANGED');
    expect(hero(e).momentum!.value).toBe(3);
    const quiet = battle('warrior', p(0, 2), [ORC('orc-1', 6, 4)]);
    play(quiet, 'wall_patience', null);
    hero(quiet).momentum!.value = 0;
    applyStatus(ctxFor(quiet), unit(quiet, 'orc-1'), 'ROOTED', 3, 'warrior');
    endTurn(quiet);
    expect(hero(quiet).momentum!.value).toBe(0);
    expect(status(quiet)).toBeUndefined();
  });

  it('PvP: the first distant hit in the rival turn gives +2, the second +1; identical on a replayed state', () => {
    const deck = DEFAULT_CONTENT.heroes.warrior!.deck;
    let s = createDuel([{ heroId: 'warrior', cards: deck }, { heroId: 'mage', cards: DEFAULT_CONTENT.heroes.mage!.deck }], 5);
    if (s.player.heroId !== 'champion-a') s = applyDuel(s, { type: 'END_TURN' }).state;
    s = structuredClone(s);
    const W = () => s.units.find((u) => u.id === 'champion-a')!;
    W().pos = p(1, 2);
    s.units.find((u) => u.id === 'champion-b')!.pos = p(5, 2);
    s.player.energy = 4;
    s.player.hand = [{ uid: 'pat', cardId: 'wall_patience' }];
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'pat', target: null }).state;
    s = applyDuel(s, { type: 'END_TURN' }).state;
    W().momentum!.value = 0;
    s.player.energy = 5;
    s.player.hand = [{ uid: 'mm1', cardId: 'magic_missile' }, { uid: 'mm2', cardId: 'magic_missile' }];
    const replayFrom = structuredClone(s);
    const run = (st: GameState) => {
      st = applyDuel(st, { type: 'PLAY_CARD', cardUid: 'mm1', target: p(1, 2) }).state;
      const first = st.units.find((u) => u.id === 'champion-a')!.momentum!.value;
      st = applyDuel(st, { type: 'PLAY_CARD', cardUid: 'mm2', target: p(1, 2) }).state;
      return { st, first, second: st.units.find((u) => u.id === 'champion-a')!.momentum!.value };
    };
    const live = run(s),
      replay = run(replayFrom);
    expect([live.first, live.second]).toEqual([2, 3]);
    expect(replay.st).toEqual(live.st);
  });
});

describe('Relevo del Pacto (Invocador)', () => {
  it('targets only an own summon at ≤3 with sight; swaps tiles; the summon gains 2 shield', () => {
    const e = battle('summoner', p(0, 2), [ORC('orc-1', 6, 2)]);
    const fox = summon(e, 'fox', p(3, 2));
    expect(targets(e, 'pact_relay').map(keyOf)).toEqual(['3,2']);
    const before = e.state.player.energy;
    expect(play(e, 'pact_relay', p(6, 2)).ok).toBe(false);
    expect(play(e, 'pact_relay', p(3, 2)).ok).toBe(true);
    expect(e.state.player.energy).toBe(before - 1);
    expect(hero(e).pos).toEqual(p(3, 2));
    expect(unit(e, fox.id).pos).toEqual(p(0, 2));
    expect(unit(e, fox.id).shield).toBe(2);
  });

  it('counterplay: no target while the Invocador is ROOTED; out of range (4) is invalid', () => {
    const e = battle('summoner', p(0, 2), [ORC('orc-1', 6, 2)]);
    summon(e, 'fox', p(2, 2));
    summon(e, 'chicken', p(4, 2));
    expect(targets(e, 'pact_relay').map(keyOf)).toEqual(['2,2']);
    applyStatus(ctxFor(e), hero(e), 'ROOTED', 1, 'orc-1');
    expect(targets(e, 'pact_relay')).toEqual([]);
  });
});

describe('Estallido Salvaje (Cambiaformas)', () => {
  const shifter = () => battle('shapeshifter', p(3, 2), [ORC('orc-1', 4, 2), ORC('orc-2', 3, 1), ORC('orc-3', 4, 3)], SHIFTER);

  it('human form: draws 1 and gains 1 movement; no transformation', () => {
    const e = shifter();
    const mp = e.state.player.movePoints;
    mutable(e).player.deck = [{ uid: 'd1', cardId: 'qa_wild_strike' }];
    expect(play(e, 'wild_burst', null).ok).toBe(true);
    expect(e.state.player.hand.map((c) => c.uid)).toEqual(['d1']);
    expect(e.state.player.movePoints).toBe(mp + 1);
    expect(unit(e, 'orc-1').hp).toBe(8);
  });

  it('beast form: back to human (armour bonus lost), 2 to orthogonal neighbours, pushed 1; diagonal untouched', () => {
    const e = shifter();
    const baseArmor = hero(e).armor;
    expect(play(e, 'qa_bear_form', null).ok).toBe(true);
    expect(hero(e).armor).toBe(baseArmor + 2);
    expect(play(e, 'wild_burst', null).ok).toBe(true);
    expect(hero(e).activeForm).toBeUndefined();
    expect(hero(e).armor).toBe(baseArmor);
    expect(unit(e, 'orc-1')).toMatchObject({ hp: 6, pos: p(5, 2) });
    expect(unit(e, 'orc-2')).toMatchObject({ hp: 6, pos: p(3, 0) });
    expect(unit(e, 'orc-3').hp).toBe(8); // diagonal
  });
});

describe('Runa de Ignición (Mago) — risk card', () => {
  it('valid: cross at ≤4 with sight; nothing at cast; public glyph; 3 fire at the start of the next turn to who stays', () => {
    const e = battle('mage', p(0, 2), [ORC('orc-1', 4, 2)]);
    expect(targets(e, 'ignition_rune').map(keyOf)).toContain('4,2');
    expect(targets(e, 'ignition_rune').map(keyOf)).not.toContain('5,2');
    expect(play(e, 'ignition_rune', p(4, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').hp).toBe(8);
    expect(e.state.glyphs).toHaveLength(1);
    expect(e.state.glyphs![0]!.tiles).toHaveLength(5);
    applyStatus(ctxFor(e), unit(e, 'orc-1'), 'ROOTED', 1, 'mage'); // root + rune: the risky combo
    const events = endTurn(e);
    expect(ofType(events, 'UNIT_DAMAGED').filter((d) => d.unitId === 'orc-1' && d.damageType === 'FIRE')).toHaveLength(1);
    expect(unit(e, 'orc-1').hp).toBe(5);
    expect(e.state.glyphs).toBeUndefined();
  });

  it('counterplay: walking out of the telegraphed cross avoids it', () => {
    const e = battle('mage', p(0, 2), [ORC('orc-1', 4, 2)]);
    play(e, 'ignition_rune', p(4, 2));
    endTurn(e); // the orc walks 3 toward the Mage: out of the cross
    expect(unit(e, 'orc-1').pos.x).toBeLessThan(3);
    expect(unit(e, 'orc-1').hp).toBeGreaterThanOrEqual(8 - 0);
    expect(e.state.glyphs).toBeUndefined();
  });

  it('invalid without line of sight', () => {
    const e = battle('mage', p(0, 2), [ORC('orc-1', 6, 4)], DEFAULT_CONTENT, { layout: ['.......', '.......', '.#.....', '.......', '.......'] });
    expect(targets(e, 'ignition_rune').map(keyOf)).not.toContain('3,2');
  });
});

describe('Eco del Altar (Invocador) — chosen piece, risk card', () => {
  const summoner = (discard: { uid: string; cardId: string }[]) => {
    const e = battle('summoner', p(0, 2), [ORC('orc-1', 6, 4)]);
    mutable(e).player.discard = discard;
    return e;
  };
  const search = (e: ReturnType<typeof battle>, uid: string, choiceUid: string) => e.dispatch({ type: 'SEARCH_SUMMON', cardUid: uid, choiceUid });

  it('zero pieces in the discard → not playable (NO_ELIGIBLE_PIECE)', () => {
    const e = summoner([{ uid: 'x', cardId: 'summon_fox' }]);
    const [uid] = setHand(e, ['altar_echo']);
    expect(e.getCardPlayability(uid!)).toMatchObject({ playable: false });
    expect(search(e, uid!, 'x')).toMatchObject({ ok: false, error: 'NO_ELIGIBLE_PIECE' });
  });

  it('choices list only ritual pieces of the own discard (most recent first); one piece → valid', () => {
    const e = summoner([{ uid: 'p1', cardId: 'mark_moon' }, { uid: 'f', cardId: 'summon_fox' }, { uid: 'p2', cardId: 'mark_fang' }]);
    expect(discardSearchChoices(e.state, e.content).map((c) => c.uid)).toEqual(['p2', 'p1']);
    const one = summoner([{ uid: 'only', cardId: 'rune_stone' }]);
    const [uid] = setHand(one, ['altar_echo']);
    expect(search(one, uid!, 'only').ok).toBe(true);
    expect(one.state.player.hand.some((c) => c.uid === 'only')).toBe(true);
  });

  it('several pieces → any can be chosen; exactly the chosen one moves; a non-ritual card or an unknown uid is refused', () => {
    const e = summoner([{ uid: 'p1', cardId: 'mark_moon' }, { uid: 'f', cardId: 'summon_fox' }, { uid: 'p2', cardId: 'mark_fang' }]);
    const [uid] = setHand(e, ['altar_echo']);
    expect(search(e, uid!, 'f')).toMatchObject({ ok: false, error: 'INVALID_TARGET' });
    expect(search(e, uid!, 'ghost')).toMatchObject({ ok: false, error: 'INVALID_TARGET' });
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(false); // no choice, no cast
    expect(e.state.player.hand.map((c) => c.uid)).toEqual([uid]);
    expect(search(e, uid!, 'p1').ok).toBe(true);
    expect(e.state.player.hand.find((c) => c.uid === 'p1')).toMatchObject({ cardId: 'mark_moon', unavailableThisTurn: true });
    expect(e.state.player.discard.map((c) => c.uid)).toEqual(['f', 'p2', uid]);
  });

  it('the piece cannot be played nor sealed this turn, works next turn; a retried command never duplicates', () => {
    const e = summoner([{ uid: 'p2', cardId: 'mark_fang' }]);
    const [uid] = setHand(e, ['altar_echo']);
    expect(search(e, uid!, 'p2').ok).toBe(true);
    expect(search(e, uid!, 'p2').ok).toBe(false); // retry: Eco is no longer in hand
    const all = [...e.state.player.hand, ...e.state.player.discard, ...e.state.player.deck].filter((c) => c.uid === 'p2');
    expect(all).toHaveLength(1);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: 'p2', target: unit(e, 'orc-1').pos })).toMatchObject({ ok: false, error: 'CARD_UNAVAILABLE_THIS_TURN' });
    expect(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: 'p2' })).toMatchObject({ ok: false, error: 'CARD_UNAVAILABLE_THIS_TURN' });
    endTurn(e);
    expect(e.state.player.hand.find((c) => c.uid === 'p2')?.unavailableThisTurn).toBeUndefined();
    expect(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: 'p2' }).ok).toBe(true);
  });

  it('PvP: the server engine rejects a fake / rival / non-ritual choice; the owner view after reconnect keeps the resolution; the rival never learns the piece', () => {
    const deck = DEFAULT_CONTENT.heroes.summoner!.deck;
    let s = createDuel([{ heroId: 'summoner', cards: deck }, { heroId: 'summoner', cards: deck }], 11);
    if (s.player.heroId !== 'champion-a') s = applyDuel(s, { type: 'END_TURN' }).state;
    s = structuredClone(s);
    s.player.energy = 4;
    s.player.hand = [{ uid: 'echo', cardId: 'altar_echo' }];
    s.player.discard = [{ uid: 'own-piece', cardId: 'mark_moon' }, { uid: 'own-fox', cardId: 'summon_fox' }];
    s.duel!.other.discard = [{ uid: 'rival-piece', cardId: 'mark_fang' }];
    for (const fake of ['rival-piece', 'own-fox', 'nope'])
      expect(() => applyDuel(s, { type: 'SEARCH_SUMMON', cardUid: 'echo', choiceUid: fake })).toThrow();
    expect(validCommand({ type: 'SEARCH_SUMMON', cardUid: 'echo', choiceUid: 'own-piece', cardId: 'seal_heart' })).toBe(true); // extra client fields are ignored…
    const { state, events } = applyDuel(s, { type: 'SEARCH_SUMMON', cardUid: 'echo', choiceUid: 'own-piece' });
    expect(state.player.hand.find((c) => c.uid === 'own-piece')).toMatchObject({ cardId: 'mark_moon', unavailableThisTurn: true });
    expect(() => applyDuel(state, { type: 'SEARCH_SUMMON', cardUid: 'echo', choiceUid: 'own-piece' })).toThrow(); // retry
    const ownView = duelView(state, 0);
    expect(ownView.player.hand.some((c) => c.uid === 'own-piece' && c.unavailableThisTurn)).toBe(true);
    expect(ownView.player.discard.some((c) => c.uid === 'own-piece')).toBe(false);
    const rivalEvents = JSON.stringify(duelEvents(state, 1, events));
    expect(rivalEvents).not.toContain('mark_moon');
    expect(rivalEvents).not.toContain('own-piece');
    expect(JSON.stringify(duelView(state, 1))).not.toContain('own-piece');
  });

  it('PvE replay with the chosen piece reproduces the state', () => {
    const sc = scenario({ hero: { heroId: 'summoner', pos: p(0, 2) }, enemies: [ORC('orc-1', 6, 4)] });
    const content = withHeroDeck(DEFAULT_CONTENT, 'summoner', [{ cardId: 'altar_echo', count: 15 }, { cardId: 'mark_moon', count: 15 }]);
    const e = makeEngine(sc, content, 3);
    const moon = e.state.player.hand.find((c) => c.cardId === 'mark_moon');
    const echo = e.state.player.hand.find((c) => c.cardId === 'altar_echo');
    expect(moon && echo).toBeTruthy();
    const cmds: Command[] = [
      { type: 'PLAY_CARD', cardUid: moon!.uid, target: unit(e, 'orc-1').pos },
      { type: 'SEARCH_SUMMON', cardUid: echo!.uid, choiceUid: moon!.uid },
    ];
    // Mark of the Moon heals an ally: target the Summoner itself.
    cmds[0] = { type: 'PLAY_CARD', cardUid: moon!.uid, target: hero(e).pos };
    for (const c of cmds) expect(e.dispatch(c).ok).toBe(true);
    const replay = replayBattle(sc, content, 3, cmds);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state).toEqual(e.state);
  });
});

describe('Salto de Asedio (Guerrero)', () => {
  it('lands next to an enemy at 2–3 with sight: 1 damage, +1 Impulso; never if the enemy is at 4', () => {
    const e = battle('warrior', p(0, 2), [ORC('orc-1', 3, 2), ORC('orc-far', 0, 6 - 2 + 0)]);
    unit(e, 'orc-far').pos = p(4, 4); // distance 6: never an anchor
    hero(e).momentum!.value = 0;
    const valid = targets(e, 'siege_leap').map(keyOf).sort();
    expect(valid).toEqual(['2,2', '3,1', '3,3', '4,2']);
    const before = e.state.player.energy;
    expect(play(e, 'siege_leap', p(4, 2)).ok).toBe(true); // land BEHIND the target: no lane needed
    expect(e.state.player.energy).toBe(before - 2);
    expect(hero(e).pos).toEqual(p(4, 2));
    expect(unit(e, 'orc-1').hp).toBe(7);
    expect(hero(e).momentum!.value).toBe(1);
    const far = battle('warrior', p(0, 2), [ORC('orc-1', 4, 2)]);
    expect(targets(far, 'siege_leap')).toEqual([]);
  });

  it('counterplay: no line of sight (pillar) or ROOTED → no leap; a trap on the landing tile springs', () => {
    const blocked = battle('warrior', p(0, 2), [ORC('orc-1', 3, 2)], DEFAULT_CONTENT, { layout: ['.......', '.......', '.#.....', '.......', '.......'] });
    expect(targets(blocked, 'siege_leap')).toEqual([]);
    const rooted = battle('warrior', p(0, 2), [ORC('orc-1', 3, 2)]);
    applyStatus(ctxFor(rooted), hero(rooted), 'ROOTED', 1, 'orc-1');
    expect(targets(rooted, 'siege_leap')).toEqual([]);
    const trapped = battle('warrior', p(0, 2), [ORC('orc-1', 3, 2)]);
    placeTrap(ctxFor(trapped), unit(trapped, 'orc-1'), p(2, 2), 'bramble_trap', 1, 3);
    expect(play(trapped, 'siege_leap', p(2, 2)).ok).toBe(true);
    expect(hero(trapped).statuses.some((s) => s.id === 'ROOTED')).toBe(true);
    expect(unit(trapped, 'orc-1').hp).toBe(7); // the leap still lands its hit
  });
});

describe('Flecha Rastreadora (Arquero)', () => {
  it('only the Presa, up to 5, through a pillar and ignoring cover; 2 damage, no Concentración', () => {
    const layout = ['.......', '.......', '.#..C..', '.......', '.......'];
    const e = battle('archer', p(0, 2), [ORC('orc-1', 4, 2), ORC('orc-2', 3, 3)], ARCHER, { layout, legend: LEGEND_C });
    expect(targets(e, 'tracking_arrow')).toEqual([]);
    markPrey(e, 'orc-1');
    expect(targets(e, 'tracking_arrow').map(keyOf)).toEqual(['4,2']);
    expect(targets(e, 'archer_shot').map(keyOf)).not.toContain('4,2'); // the pillar blocks normal shots
    expect(play(e, 'tracking_arrow', p(4, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').hp).toBe(6); // cover (rangedReduction 1) ignored
    expect(hero(e).focus!.value).toBe(0);
    expect(play(e, 'tracking_arrow', p(3, 3)).ok).toBe(false);
  });

  it('range 5, not 6; a cleansed Presa can no longer be targeted', () => {
    const e = battle('archer', p(0, 2), [ORC('orc-1', 6, 2)], ARCHER);
    markPrey(e, 'orc-1');
    expect(targets(e, 'tracking_arrow')).toEqual([]);
    unit(e, 'orc-1').pos = p(5, 2);
    expect(targets(e, 'tracking_arrow').map(keyOf)).toEqual(['5,2']);
    unit(e, 'orc-1').statuses = [];
    expect(targets(e, 'tracking_arrow')).toEqual([]);
  });
});

describe('Intercambio Arcano (Mago) — risk card', () => {
  it('swaps with any non-structure unit at 1–4 with sight; an enemy is slowed 1 turn; distance between both is kept', () => {
    const e = battle('mage', p(0, 2), [ORC('orc-1', 4, 2)], DEFAULT_CONTENT, {
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(1, 1) }] as never,
    });
    const valid = targets(e, 'arcane_exchange').map(keyOf);
    expect(valid).toContain('4,2');
    expect(valid).not.toContain('0,2');
    expect(valid).not.toContain('1,1');
    expect(play(e, 'arcane_exchange', p(4, 2)).ok).toBe(true);
    expect(hero(e).pos).toEqual(p(4, 2));
    expect(unit(e, 'orc-1').pos).toEqual(p(0, 2));
    expect(unit(e, 'orc-1').statuses.find((s) => s.id === 'SLOWED')?.turnsLeft).toBe(1);
  });

  it('invalid beyond 4 or without sight', () => {
    const far = battle('mage', p(0, 2), [ORC('orc-1', 5, 2)]);
    expect(targets(far, 'arcane_exchange')).toEqual([]);
    const blocked = battle('mage', p(0, 2), [ORC('orc-1', 3, 2)], DEFAULT_CONTENT, { layout: ['.......', '.......', '.#.....', '.......', '.......'] });
    expect(targets(blocked, 'arcane_exchange')).toEqual([]);
  });

  it('swapping onto a hostile trap springs it (both moves are teleports)', () => {
    const e = battle('mage', p(0, 2), [ORC('orc-1', 3, 2)]);
    placeTrap(ctxFor(e), hero(e), p(0, 2), 'bramble_trap', 1, 3); // the Mage's own trap: hostile to the orc
    expect(play(e, 'arcane_exchange', p(3, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').statuses.some((s) => s.id === 'ROOTED')).toBe(true);
    expect(unit(e, 'orc-1').hp).toBe(7);
  });
});

describe('Ranked cards: replay + PvP determinism', () => {
  it('PvE replay (rune → exchange → end turn → rune resolves) reproduces the exact state', () => {
    const content = withHeroDeck(DEFAULT_CONTENT, 'mage', [{ cardId: 'ignition_rune', count: 15 }, { cardId: 'arcane_exchange', count: 15 }]);
    const sc = scenario({ hero: { heroId: 'mage', pos: p(0, 2) }, enemies: [ORC('orc-1', 4, 2)] });
    const e = makeEngine(sc, content, 9);
    const cmds: Command[] = [];
    const run = (c: Command) => {
      expect(e.dispatch(c).ok).toBe(true);
      cmds.push(c);
    };
    const uidOf = (id: string) => e.state.player.hand.find((c) => c.cardId === id)!.uid;
    run({ type: 'PLAY_CARD', cardUid: uidOf('ignition_rune'), target: p(4, 2) });
    run({ type: 'PLAY_CARD', cardUid: uidOf('arcane_exchange'), target: p(4, 2) });
    run({ type: 'END_TURN' });
    const replay = replayBattle(sc, content, 9, cmds);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state).toEqual(e.state);
  });

  it('PvP: Archer palisade + tracking arrow vs Warrior siege leap — identical in both seat views', () => {
    const warriorDeck = DEFAULT_CONTENT.heroes.warrior!.deck;
    let s = createDuel([{ heroId: 'archer', cards: ARCHER_HERO.deck }, { heroId: 'warrior', cards: warriorDeck }], 7, 'DUEL', 'classic', ARCHER);
    const seatOf = (st: GameState) => (st.player.heroId === 'champion-a' ? 0 : 1);
    if (seatOf(s) !== 0) s = applyDuel(s, { type: 'END_TURN' }, ARCHER).state;
    const A = () => s.units.find((u) => u.id === 'champion-a')!;
    const B = () => s.units.find((u) => u.id === 'champion-b')!;
    s = structuredClone(s);
    A().pos = p(1, 2);
    B().pos = p(5, 2);
    B().statuses.push({ id: 'PREY', turnsLeft: 1, sourceId: 'champion-a' });
    s.player.energy = 4;
    s.player.hand = [{ uid: 'pal', cardId: 'palisade' }, { uid: 'trk', cardId: 'tracking_arrow' }];
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'pal', target: p(2, 2) }, ARCHER).state;
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'trk', target: p(5, 2) }, ARCHER).state;
    expect(B().hp).toBe(22);
    s = applyDuel(s, { type: 'END_TURN', discardUid: s.player.hand.length > 5 ? s.player.hand.at(-1)!.uid : undefined } as Command, ARCHER).state;
    expect(s.player.heroId).toBe('champion-b');
    B().pos = p(4, 2);
    s.player.energy = 4;
    s.player.hand = [{ uid: 'leap', cardId: 'siege_leap' }];
    const before = structuredClone(s);
    const a = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'leap', target: p(1, 3) }, ARCHER).state;
    const b = applyDuel(before, { type: 'PLAY_CARD', cardUid: 'leap', target: p(1, 3) }, ARCHER).state;
    expect(a).toEqual(b);
    s = a;
    expect(B().pos).toEqual(p(1, 3));
    expect(A().hp).toBe(17);
    const v0 = duelView(s, 0, ARCHER),
      v1 = duelView(s, 1, ARCHER);
    expect(v0.units.find((u) => u.id === 'champion-b')!.pos).toEqual(v1.units.find((u) => u.id === 'champion-b')!.pos);
    expect(v0.obstacles.some((o) => o.defId === 'rubble')).toBe(true);
    expect(v1.obstacles.some((o) => o.defId === 'rubble')).toBe(true);
  });

  it('PvP: a glyph is public to both seats and resolves at its owner\'s next turn start', () => {
    const mageDeck = DEFAULT_CONTENT.heroes.mage!.deck;
    let s = createDuel([{ heroId: 'mage', cards: mageDeck }, { heroId: 'mage', cards: mageDeck }], 3);
    if (s.player.heroId !== 'champion-a') s = applyDuel(s, { type: 'END_TURN' }).state;
    s = structuredClone(s);
    const B = () => s.units.find((u) => u.id === 'champion-b')!;
    s.units.find((u) => u.id === 'champion-a')!.pos = p(1, 2);
    B().pos = p(4, 2);
    s.player.energy = 5;
    s.player.hand = [{ uid: 'rune', cardId: 'ignition_rune' }];
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'rune', target: p(4, 2) }).state;
    expect(duelView(s, 1).glyphs).toEqual(duelView(s, 0).glyphs);
    expect(duelView(s, 1).glyphs).toHaveLength(1);
    s = applyDuel(s, { type: 'END_TURN' }).state; // rival's turn: it stays
    const hp = B().hp;
    s = applyDuel(s, { type: 'END_TURN', discardUid: s.player.hand.length > 5 ? s.player.hand.at(-1)!.uid : undefined } as Command).state;
    expect(B().hp).toBe(hp - 3);
    expect(s.glyphs).toBeUndefined();
  });
});
