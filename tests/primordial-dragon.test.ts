import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ASCENT_CAMPAIGN,
  DECK_RULES,
  DEFAULT_CONTENT,
  GameEngine,
  PRIMORDIAL_EXPANSION,
  PRIMORDIAL_SET,
  RITUAL_EXPANSION,
  campaignBattleContent,
  copyLimit,
  createProfile,
  createRun,
  currentEncounter,
  replayBattle,
  rollReward,
  suggestRitualAction,
  validateDeck,
  verifyVictory,
  type Command,
  type DeckEntry,
  type GameContent,
  type GameEvent,
  type GameState,
  type PlayerProfile,
} from '../src/game';
import { actSummons, summonUsage } from '../src/game/domain/summons/summons';
import { queryContext } from '../src/game/domain/context';
import { dealDamage } from '../src/game/domain/combat/damage';
import { applyDuel, createDuel, duelEvents, duelView } from '../src/game/pvp/duel';
import { PvPMatchRoom } from '../server/src/pvp';
import { releasedContent } from '../server/src/ritualRelease';
import { ctxFor, makeEngine, mutable, p, setHand } from './helpers';
import { memoryD1 } from './support/d1';
import { playBattle } from './support/bot';

const SEALS = ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart'] as const;
const SUMMONER = { heroId: 'summoner', pos: p(0, 2) };
const engine = (overrides = {}) => makeEngine({ hero: SUMMONER, ...overrides });
const error = (r: ReturnType<GameEngine['dispatch']>) => (r.ok ? 'OK' : r.error);
const summons = (e: GameEngine) => e.state.units.filter((u) => u.kind === 'SUMMON');
const setAltar = (e: GameEngine, ids: readonly string[]) => {
  mutable(e).player.altar = ids.map((cardId, i) => ({ uid: `altar-${cardId}-${i}`, cardId }));
};
const dragonDef = DEFAULT_CONTENT.summons!.primordial_dragon!;

/** Activates the ritual on a prepared altar and returns the dragon unit. */
function summonDragon(e: GameEngine, at = p(1, 2)) {
  setAltar(e, SEALS);
  mutable(e).player.energy = 3;
  const r = e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: at });
  expect(r.ok).toBe(true);
  return summons(e).find((u) => u.defId === 'primordial_dragon')!;
}
/** Puts the dragon somewhere and lets it act this round (summons act from the round after spawn). */
function readyDragon(e: GameEngine, at: { x: number; y: number }) {
  const dragon = summonDragon(e);
  mutable(e).units.find((u) => u.id === dragon.id)!.pos = at;
  mutable(e).round = dragon.summon!.readyRound;
  return mutable(e).units.find((u) => u.id === dragon.id)!;
}
const act = (e: GameEngine) => {
  const events: GameEvent[] = [];
  actSummons(ctxFor(e, events));
  return events;
};

/** The Summoner starter with 8 slots turned into the four seals at 2 copies. */
function dedicatedDeck(): DeckEntry[] {
  const deck = DEFAULT_CONTENT.heroes.summoner!.deck.map((e) => ({ ...e }));
  let out = 8;
  for (const e of [...deck].reverse())
    while (out > 0 && e.count > 1) {
      e.count--;
      out--;
    }
  return [...deck.filter((e) => e.count > 0), ...SEALS.map((cardId) => ({ cardId, count: 2 }))];
}

describe('four seals', () => {
  it('four RARE seals of the summoner_primordial set, 2 copies each, never in a starter', () => {
    expect(PRIMORDIAL_SET.seals).toEqual([...SEALS]);
    for (const id of SEALS) {
      const card = DEFAULT_CONTENT.cards[id]!;
      expect(card).toMatchObject({ heroId: 'summoner', rarity: 'RARE', ritualPiece: true, expansion: PRIMORDIAL_EXPANSION, cost: 1 });
      expect(copyLimit(card, DECK_RULES)).toBe(2);
      for (const hero of Object.values(DEFAULT_CONTENT.heroes)) expect(hero.deck.map((e) => e.cardId)).not.toContain(id);
    }
    expect(DEFAULT_CONTENT.cards.seal_claw!.name).toBe('Sello de la Garra Primordial');
    expect(DEFAULT_CONTENT.cards.seal_heart!.name).toBe('Sello del Corazón Primordial');
    // The rarity limit is unchanged for every other RARE card.
    expect(copyLimit(DEFAULT_CONTENT.cards.summon_war_drake!, DECK_RULES)).toBe(1);
  });

  it('deck rules: 2 copies of each seal (8 slots) are legal, a third copy is not', () => {
    const deck = dedicatedDeck();
    expect(deck.reduce((n, e) => n + e.count, 0)).toBe(30);
    expect(validateDeck(deck, 'summoner', () => 9, DEFAULT_CONTENT, DECK_RULES)).toEqual([]);
    const three = deck.map((e) => (e.cardId === 'seal_wing' ? { ...e, count: 3 } : e)).map((e) => (e.cardId === 'seal_claw' ? { ...e, count: 1 } : e));
    expect(validateDeck(three, 'summoner', () => 9, DEFAULT_CONTENT, DECK_RULES)).toContainEqual({ code: 'COPY_LIMIT', cardId: 'seal_wing', count: 3, limit: 2 });
    // Owning 1 copy only allows 1 in the deck.
    expect(validateDeck(deck, 'summoner', (id) => (id === 'seal_fang' ? 1 : 9), DEFAULT_CONTENT, DECK_RULES).map((i) => i.code)).toContain('NOT_ENOUGH_COPIES');
    expect(validateDeck(deck, 'mage', () => 9, DEFAULT_CONTENT, DECK_RULES).map((i) => i.code)).toContain('WRONG_HERO');
  });
});

describe('piece utility (each seal played normally)', () => {
  it('Garra: 1 physical damage to an enemy at distance 2', () => {
    const e = engine({ enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2) }] });
    const [claw] = setHand(e, ['seal_claw']);
    const hp = e.state.units.find((u) => u.id === 'orc-1')!.hp;
    const r = e.dispatch({ type: 'PLAY_CARD', cardUid: claw!, target: p(2, 2) });
    expect(r.ok).toBe(true);
    expect(r.ok && r.events.find((ev) => ev.type === 'UNIT_DAMAGED')).toMatchObject({ unitId: 'orc-1', rawAmount: 1, damageType: 'PHYSICAL' });
    expect(e.state.units.find((u) => u.id === 'orc-1')!.hp).toBeLessThanOrEqual(hp);
    expect(e.state.player.energy).toBe(e.state.player.maxEnergy - 1);
  });

  it('Colmillo: marks an enemy at distance 2 as prey for 1 round', () => {
    const e = engine({ enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2) }] });
    const [fang] = setHand(e, ['seal_fang']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: fang!, target: p(2, 2) }).ok).toBe(true);
    expect(e.state.units.find((u) => u.id === 'orc-1')!.statuses).toContainEqual(expect.objectContaining({ id: 'MARKED_PREY', sourceId: 'summoner' }));
    const far = engine();
    const [fang2] = setHand(far, ['seal_fang']);
    expect(error(far.dispatch({ type: 'PLAY_CARD', cardUid: fang2!, target: p(6, 2) }))).not.toBe('OK');
  });

  it('Ala: steps the Summoner up to 2 tiles without spending movement; Enraizado blocks it', () => {
    const e = engine();
    const [wing] = setHand(e, ['seal_wing']);
    const move = e.state.player.movePoints;
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: wing!, target: p(2, 2) }).ok).toBe(true);
    expect(e.state.units.find((u) => u.id === 'summoner')!.pos).toEqual(p(2, 2));
    expect(e.state.player.movePoints).toBe(move);
    const rooted = engine();
    mutable(rooted).units.find((u) => u.id === 'summoner')!.statuses = [{ id: 'ROOTED', turnsLeft: 2 }];
    const [wing2] = setHand(rooted, ['seal_wing']);
    expect(error(rooted.dispatch({ type: 'PLAY_CARD', cardUid: wing2!, target: p(1, 2) }))).not.toBe('OK');
  });

  it('Corazón: 2 shield to the Summoner', () => {
    const e = engine();
    const [heart] = setHand(e, ['seal_heart']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: heart!, target: null }).ok).toBe(true);
    expect(e.state.units.find((u) => u.id === 'summoner')!.shield).toBe(2);
  });
});

describe('ritual activation', () => {
  it('seals cost 0/1/1/1 and the altar status walks 0/4 → 3/4 → READY', () => {
    const e = engine();
    mutable(e).player.energy = 4;
    const status = () => e.getAltarStatus()!.rituals.find((r) => r.ritualId === 'primordial_dragon')!;
    expect(status()).toMatchObject({ name: 'Ritual del Dragón Primordial', progressLabel: '0/4', missingCount: 4, energyCost: 3, replacesSummons: true, ready: false });
    expect(status().creature).toMatchObject({ name: 'Dragón Primordial', maxHp: 26 });
    const uids = setHand(e, [...SEALS]);
    const paid: number[] = [];
    for (const [i, uid] of uids.entries()) {
      const before = e.state.player.energy;
      expect(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: uid }).ok).toBe(true);
      paid.push(before - e.state.player.energy);
      if (i < 3) expect(status()).toMatchObject({ progressLabel: `${i + 1}/4`, missingCount: 3 - i });
    }
    expect(paid).toEqual([0, 1, 1, 1]);
    // Complete but only 1 energy left: 4/4 with the blocked reason, not READY.
    expect(status()).toMatchObject({ complete: true, ready: false, progressLabel: '4/4', missingCount: 0, blockedBy: { code: 'NOT_ENOUGH_ENERGY' } });
    mutable(e).player.energy = 3;
    expect(status()).toMatchObject({ ready: true, progressLabel: 'READY' });
  });

  it('requires four distinct pieces: a duplicate seal never fills another slot', () => {
    const e = engine();
    const [a, b] = setHand(e, ['seal_claw', 'seal_claw']);
    expect(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: a! }).ok).toBe(true);
    expect(error(e.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: b! }))).toBe('ALTAR_DUPLICATE');
    // Three of four (even with energy to spare) cannot activate; nothing changes.
    setAltar(e, ['seal_claw', 'seal_fang', 'seal_wing']);
    mutable(e).player.energy = 4;
    const before = structuredClone(e.state);
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: p(1, 2) }))).toBe('RITUAL_INCOMPLETE');
    expect(e.state).toEqual(before);
    // Other rituals' pieces never count.
    setAltar(e, ['seal_claw', 'seal_fang', 'seal_wing', 'mark_moon']);
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: p(1, 2) }))).toBe('RITUAL_INCOMPLETE');
  });

  it('costs 3 energy (2 is not enough), consumes the four seals into the discard pile', () => {
    const e = engine();
    setAltar(e, SEALS);
    mutable(e).player.energy = 2;
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: p(1, 2) }))).toBe('NOT_ENOUGH_ENERGY');
    mutable(e).player.energy = 3;
    const r = e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: p(1, 2) });
    expect(r.ok).toBe(true);
    expect(e.state.player.energy).toBe(0);
    expect(e.state.player.altar).toEqual([]);
    expect(e.state.player.discard.map((c) => c.cardId)).toEqual(expect.arrayContaining([...SEALS]));
    expect(r.ok && r.events.find((ev) => ev.type === 'RITUAL_ACTIVATED')).toMatchObject({ ritualId: 'primordial_dragon', tier: 'LEGENDARY' });
  });

  it('replaces every current summon and takes the whole capacity; nothing else can be summoned beside it', () => {
    const e = engine();
    const [wolf] = setHand(e, ['summon_chicken']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: wolf!, target: p(1, 1) }).ok).toBe(true);
    expect(summons(e)).toHaveLength(1);
    summonDragon(e);
    expect(summons(e).map((u) => u.defId)).toEqual(['primordial_dragon']);
    expect(summonUsage(e.state, 'summoner')).toBe(DEFAULT_CONTENT.heroes.summoner!.summonCapacity);
    mutable(e).player.energy = 4;
    for (const card of ['summon_chicken', 'summon_war_drake']) {
      const [uid] = setHand(e, [card]);
      expect(error(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(1, 3) })), card).not.toBe('OK');
    }
    // Once per battle.
    setAltar(e, SEALS);
    mutable(e).player.energy = 3;
    expect(error(e.dispatch({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: p(1, 3) }))).toBe('RITUAL_LIMIT');
  });
});

describe('Dragón Primordial', () => {
  it('stats: 26 HP, armor 1, move 2, bite 5, capacity = all; stronger than the Dragón de Guerra', () => {
    expect(dragonDef).toMatchObject({ name: 'Dragón Primordial', maxHp: 26, armor: 1, moveRange: 2, damage: 5, attackRange: 1, capacityCost: 2 });
    const drake = DEFAULT_CONTENT.summons!.war_drake!;
    expect(dragonDef.maxHp).toBeGreaterThan(drake.maxHp);
    expect(dragonDef.damage).toBeGreaterThan(drake.damage);
    // Direct vs ritual identity: the drake is one card; the dragon only comes from the ritual.
    expect(Object.values(DEFAULT_CONTENT.cards).some((c) => c.effects.some((fx) => fx.type === 'SUMMON' && fx.summonId === 'primordial_dragon'))).toBe(false);
  });

  it('acts from the next round and bites a single adjacent enemy for 5', () => {
    const e = engine({ enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 2) }] });
    const dragon = summonDragon(e);
    expect(act(e).some((ev) => ev.type === 'SUMMON_ATTACKED' || ev.type === 'SUMMON_BREATH')).toBe(false); // spawn round
    mutable(e).units.find((u) => u.id === dragon.id)!.pos = p(3, 2);
    mutable(e).round = dragon.summon!.readyRound;
    const events = act(e);
    expect(events.some((ev) => ev.type === 'SUMMON_BREATH')).toBe(false);
    expect(events.find((ev) => ev.type === 'UNIT_DAMAGED')).toMatchObject({ unitId: 'orc-1', rawAmount: 5 });
  });

  it('Aliento Primordial: 4 arcane to every enemy in the cone, never allies, then every other round', () => {
    const enemies = [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) },
      { id: 'orc-2', enemyId: 'orc_warrior', pos: p(4, 2) },
      { id: 'orc-3', enemyId: 'orc_warrior', pos: p(3, 1) },
      { id: 'orc-far', enemyId: 'orc_warrior', pos: p(6, 0) },
    ];
    const e = engine({ enemies });
    const dragon = readyDragon(e, p(2, 2));
    dragon.statuses = [{ id: 'ROOTED', turnsLeft: 9 }]; // keep the geometry fixed
    const events = act(e);
    const breath = events.find((ev) => ev.type === 'SUMMON_BREATH');
    expect(breath).toMatchObject({ unitId: dragon.id, name: 'Aliento Primordial', from: p(2, 2), direction: p(1, 0) });
    expect(breath && breath.type === 'SUMMON_BREATH' && breath.targetIds.sort()).toEqual(['orc-1', 'orc-2', 'orc-3']);
    const hits = events.filter((ev) => ev.type === 'UNIT_DAMAGED');
    expect(hits.map((h) => h.type === 'UNIT_DAMAGED' && [h.unitId, h.rawAmount, h.damageType])).toEqual(
      expect.arrayContaining([['orc-1', 4, 'ARCANE'], ['orc-2', 4, 'ARCANE'], ['orc-3', 4, 'ARCANE']]),
    );
    expect(hits.some((h) => h.type === 'UNIT_DAMAGED' && (h.unitId === 'orc-far' || h.unitId === 'summoner'))).toBe(false);
    expect(events.some((ev) => ev.type === 'SUMMON_ATTACKED')).toBe(false); // the breath replaces the bite
    // Next round: on cooldown → a normal bite.
    const round = e.state.round;
    mutable(e).round = round + 1;
    const next = act(e);
    expect(next.some((ev) => ev.type === 'SUMMON_BREATH')).toBe(false);
    expect(next.filter((ev) => ev.type === 'SUMMON_ATTACKED')).toHaveLength(1);
    // Two rounds later it breathes again.
    mutable(e).round = round + 2;
    expect(act(e).some((ev) => ev.type === 'SUMMON_BREATH')).toBe(true);
  });

  it('one enemy in reach of the bite: bites (5) instead of a single-target breath (4); breath reaches when the bite cannot', () => {
    const e = engine({ enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 2) }] });
    const dragon = readyDragon(e, p(2, 2));
    dragon.statuses = [{ id: 'ROOTED', turnsLeft: 9 }];
    // Rooted at distance 2: the bite cannot reach, the breath can.
    expect(act(e).find((ev) => ev.type === 'SUMMON_BREATH')).toMatchObject({ targetIds: ['orc-1'] });
    const adj = engine({ enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) }] });
    readyDragon(adj, p(2, 2));
    const events = act(adj);
    expect(events.some((ev) => ev.type === 'SUMMON_BREATH')).toBe(false);
    expect(events.find((ev) => ev.type === 'UNIT_DAMAGED')).toMatchObject({ rawAmount: 5 });
  });

  it('the breath needs line of sight (a pillar shields the tile behind it)', () => {
    const e = engine({
      layout: ['.......', '.......', '...#...', '.......', '.......'],
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 2) }],
    });
    const dragon = readyDragon(e, p(2, 2));
    dragon.statuses = [{ id: 'ROOTED', turnsLeft: 9 }];
    expect(act(e).some((ev) => ev.type === 'SUMMON_BREATH')).toBe(false);
  });

  it('not an auto-win: control stops it, it takes damage and dies, freeing the capacity', () => {
    const e = engine({ enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) }, { id: 'orc-2', enemyId: 'orc_warrior', pos: p(4, 2) }] });
    const dragon = readyDragon(e, p(2, 2));
    dragon.statuses = [{ id: 'STUNNED', turnsLeft: 1 }];
    expect(act(e).some((ev) => ev.type === 'SUMMON_BREATH' || ev.type === 'SUMMON_ATTACKED')).toBe(false);
    const ctx = ctxFor(e);
    dealDamage(ctx, dragon, 10, 'orc-1', 'PHYSICAL');
    expect(dragon.hp).toBe(26 - 9); // armor 1
    dealDamage(ctx, dragon, 99, 'orc-1', 'PHYSICAL');
    expect(summons(e)).toEqual([]);
    expect(summonUsage(e.state, 'summoner')).toBe(0);
  });
});

describe('acquisition and release', () => {
  const roll = (content: GameContent, seed: number) =>
    rollReward({ content, heroId: 'summoner', owned: () => 0, pity: 4, rules: DECK_RULES, poolId: 'BOSS', seed, count: 3 });
  const offered = (content: GameContent) =>
    new Set(Array.from({ length: 300 }, (_, i) => roll(content, i + 1).options.flatMap((o) => (o.kind === 'ADD_CARD' ? [o.cardId] : []))).flat());

  it('never dropped until released (even with the other ritual sets out); then the seals drop as Summoner rewards', () => {
    const live = { ...DEFAULT_CONTENT, releasedExpansions: [RITUAL_EXPANSION] };
    expect([...offered(live)].filter((id) => id.startsWith('seal_'))).toEqual([]);
    const open = offered({ ...live, releasedExpansions: [RITUAL_EXPANSION, PRIMORDIAL_EXPANSION] });
    expect(SEALS.every((id) => open.has(id))).toBe(true);
  });

  it('server switch: PRIMORDIAL_DRAGON_ENABLED adds only its set; the approved production config releases it with QA grants off', () => {
    const env = { DB: null as never, SUMMONER_RITUALS_ENABLED: '1' };
    expect(releasedContent(DEFAULT_CONTENT, env).releasedExpansions).toEqual([...(DEFAULT_CONTENT.releasedExpansions ?? []), RITUAL_EXPANSION]);
    expect(releasedContent(DEFAULT_CONTENT, { ...env, PRIMORDIAL_DRAGON_ENABLED: '1' }).releasedExpansions).toEqual([...(DEFAULT_CONTENT.releasedExpansions ?? []), RITUAL_EXPANSION, PRIMORDIAL_EXPANSION]);
    expect(readFileSync(new URL('../server/wrangler.toml', import.meta.url), 'utf8')).toMatch(/PRIMORDIAL_DRAGON_ENABLED\s*=\s*"1"/);
    expect(readFileSync(new URL('../.env.production', import.meta.url), 'utf8')).toMatch(/VITE_PRIMORDIAL_DRAGON=1/);
    expect(readFileSync(new URL('../.env.production', import.meta.url), 'utf8')).not.toMatch(/VITE_PRIMORDIAL_DRAGON_QA=1/);
  });
});

// ── PvP ────────────────────────────────────────────────────────────────────────────────────

function sealDuel(seed = 5) {
  const starter = DEFAULT_CONTENT.heroes.summoner!.deck;
  const s = createDuel([{ heroId: 'summoner', cards: starter }, { heroId: 'summoner', cards: starter }], seed);
  s.player.hand = SEALS.map((cardId) => ({ uid: `secret-${cardId}`, cardId }));
  s.player.energy = 4;
  return s;
}

describe('PvP authority and hidden altar', () => {
  it('the rival sees only the seal count; the activation (pieces + dragon) is public', () => {
    let s = sealDuel();
    const seat = s.duel!.active,
      rival = (1 - seat) as 0 | 1;
    const seen: string[] = [];
    for (const cardId of SEALS) {
      const applied = applyDuel(s, { type: 'COMMIT_RITUAL_PIECE', cardUid: `secret-${cardId}` });
      s = applied.state;
      seen.push(JSON.stringify({ game: duelView(s, rival), events: duelEvents(s, rival, applied.events) }));
    }
    for (const view of seen) for (const id of [...SEALS, 'secret-']) expect(view).not.toContain(id);
    expect(duelView(s, rival).pileCounts.opponentAltar).toBe(4);
    expect(duelView(s, seat).player.altar!.map((c) => c.cardId)).toEqual([...SEALS]);
    // Ends the turn (energy 1 left): the next own turn has energy for the activation.
    s = applyDuel(s, { type: 'END_TURN' }).state;
    expect(JSON.stringify(duelView(s, rival))).not.toContain('seal_');
    s = applyDuel(s, { type: 'END_TURN', ...(s.player.hand.length > 5 ? { discardUid: s.player.hand.at(-1)!.uid } : {}) }).state;
    // The legal target the rules themselves suggest (closest valid tile to an enemy).
    const suggestion = suggestRitualAction(queryContext(s, DEFAULT_CONTENT));
    expect(suggestion).toMatchObject({ type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon' });
    const tile = suggestion!.type === 'ACTIVATE_RITUAL' ? suggestion!.target : null;
    const activated = applyDuel(s, { type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: tile });
    const theirs = duelEvents(activated.state, rival, activated.events);
    expect(theirs.find((ev) => ev.type === 'RITUAL_ACTIVATED')).toMatchObject({ ritualId: 'primordial_dragon', pieces: expect.arrayContaining([expect.objectContaining({ cardId: 'seal_heart' })]) });
    expect(duelView(activated.state, rival).units.some((u) => u.defId === 'primordial_dragon')).toBe(true);
  });

  it('server room: a forged dragon activation (no seals, forged fields) is rejected; the altar survives a restart', async () => {
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
    const boot = async () => {
      const room = new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], { DB: db });
      await init;
      return room;
    };
    const loadout = { heroId: 'summoner', cards: DEFAULT_CONTENT.heroes.summoner!.deck };
    const post = (room: PvPMatchRoom, path: string, id: number) =>
      room.fetch(new Request('https://room/' + path, { method: 'POST', headers: { 'X-Pvp-User': String(id), 'X-Pvp-Name': 'QA' + id }, body: JSON.stringify({ code: 'ABCDEFGH', loadout }) }));
    let room = await boot();
    await post(room, 'create', 1);
    await post(room, 'join', 2);
    const a = new FakeSocket(0), b = new FakeSocket(1);
    sockets.push(a, b);
    (data.get('room') as { members: { offlineAt: number | null }[] }).members.forEach((m) => (m.offlineAt = null));
    room = await boot();
    await post(room, 'ready', 1);
    await post(room, 'ready', 2);
    const stored = data.get('room') as { game: GameState; version: number };
    const me = stored.game.duel!.active === 0 ? a : b, rival = me === a ? b : a;
    stored.game.player.energy = 4;
    stored.game.player.hand[0] = { uid: 'secret-claw', cardId: 'seal_claw' };
    room = await boot();
    const send = (s: FakeSocket, msg: unknown) => room.webSocketMessage(s as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0], JSON.stringify(msg));
    await send(me, { id: 'forge', version: stored.version, command: { type: 'ACTIVATE_RITUAL', ritualId: 'primordial_dragon', target: { x: 1, y: 1 }, pieces: [...SEALS], summonId: 'primordial_dragon' } });
    expect(me.messages.at(-1)).toContain('RITUAL_INCOMPLETE');
    await send(me, { id: 'seal', version: stored.version, command: { type: 'COMMIT_RITUAL_PIECE', cardUid: 'secret-claw' } });
    expect(rival.messages.at(-1)).not.toContain('seal_claw');
    room = await boot(); // reconnect / eviction
    await send(me, { type: 'resync' });
    await send(rival, { type: 'resync' });
    expect(JSON.parse(me.messages.at(-1)!).game.player.altar).toEqual([{ uid: 'secret-claw', cardId: 'seal_claw' }]);
    expect(rival.messages.at(-1)).not.toContain('seal_claw');
    expect(JSON.parse(rival.messages.at(-1)!).game.pileCounts.opponentAltar).toBe(1);
    expect((data.get('room') as typeof stored).game.units.some((u) => u.defId === 'primordial_dragon')).toBe(false);
  });
});

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

describe('replay determinism', () => {
  function dedicatedProfile(): PlayerProfile {
    const profile = createProfile(DEFAULT_CONTENT);
    const hero = profile.heroes.summoner!;
    const deck = dedicatedDeck();
    for (const e of deck) hero.collection[e.cardId] = { copies: Math.max(e.count, hero.collection[e.cardId]?.copies ?? 0), acquired: 1 };
    hero.decks = [{ id: 'main', name: 'Primordial', cards: deck }];
    return profile;
  }

  it('a campaign battle that summons the Dragón Primordial (and breathes) replays exactly and verifies', () => {
    const profile = dedicatedProfile();
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked === 0; seed++) {
      const run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, seed, 'summoner');
      const content = campaignBattleContent(DEFAULT_CONTENT, profile, run, DECK_RULES);
      const e = new GameEngine(currentEncounter(ASCENT_CAMPAIGN, run), content, seed);
      playBattle(e, 20, undefined, { summonAware: true, rituals: true });
      if (!e.history.some((c: Command) => c.type === 'ACTIVATE_RITUAL' && c.ritualId === 'primordial_dragon')) continue;
      const replay = replayBattle(currentEncounter(ASCENT_CAMPAIGN, run), content, seed, e.history);
      expect(replay.rejectedAt).toBeNull();
      expect(replay.state).toEqual(e.state);
      if (e.state.outcome?.result === 'WON') {
        const proof = JSON.parse(JSON.stringify({ encounterId: run.currentEncounterId, seed, commands: e.history }));
        expect(verifyVictory(ASCENT_CAMPAIGN, DEFAULT_CONTENT, profile, run, proof, DECK_RULES)).toEqual({ ok: true });
      }
      checked++;
    }
    expect(checked).toBe(1);
  }, 120_000);
});

describe('QA access (guest dev mode)', () => {
  it('`vite --mode primordialqa` gives a guest 2 copies of every seal; otherwise nothing; unreleased seals stay hidden unless owned', async () => {
    const { withPrimordialQaSeals, primordialCardVisible } = await import('../src/presentation/campaignRelease');
    const fresh = createProfile(DEFAULT_CONTENT);
    expect(withPrimordialQaSeals(fresh)).toBe(fresh);
    const seal = DEFAULT_CONTENT.cards.seal_claw!;
    expect(primordialCardVisible(seal, 0)).toBe(false);
    expect(primordialCardVisible(seal, 1)).toBe(true);
    expect(primordialCardVisible(DEFAULT_CONTENT.cards.summon_war_drake!, 0)).toBe(true);
    vi.stubEnv('VITE_PRIMORDIAL_DRAGON_QA', '1');
    try {
      const qa = withPrimordialQaSeals(fresh);
      for (const id of SEALS) expect(qa.heroes.summoner!.collection[id]?.copies, id).toBe(2);
      expect(withPrimordialQaSeals(qa)).toEqual(qa); // idempotent on every boot
      expect(primordialCardVisible(seal, 0)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
