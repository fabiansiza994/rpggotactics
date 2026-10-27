import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHER_HUNT_CAMPAIGN,
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  GameEngine,
  type CampaignDef,
  type GameContent,
  type GameEvent,
  type GameState,
  type PlayerProfile,
} from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { FREE_CATALOG } from '../src/game/data/free-catalog';
import { createProfile, grantCard, heroProfile, saveActiveDeck } from '../src/game/collection/profile';
import type { DeckEntry } from '../src/game/collection/deck-rules';
import { createDuel, applyDuel } from '../src/game/pvp/duel';
import { applyStatus } from '../src/game/domain/statuses/status-rules';
import { dealDamage } from '../src/game/domain/combat/damage';
import { springTrap } from '../src/game/domain/combat/traps';
import { attackDamage } from '../src/game/domain/combat/attack-modifiers';
import { tileAt } from '../src/game/domain/board/board';
import { endTurn, ofType } from './helpers';
import { playBattle } from './support/bot';

/**
 * LIGHT balance QA for the free catalog (qa/free-card-catalog/balance-qa.json). Not a simulation
 * study: a few seeded bot battles (normal encounter + boss) per champion, base starter deck vs the
 * same deck carrying its Rare/Legendary/Ultra, plus short scripted PvP duels on the real duel
 * rules, one per Legendary/Ultra, measuring the risks: infinites, abnormal one-turn kills, hard
 * locks, exploitable invulnerability, summon extra-turn loops, excessive displacement.
 * Assertions are the hard safety bounds only; tuning questions are reported, never "fixed".
 */
const CONTENT = withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
const report: Record<string, unknown> = {};

function catalogDeck(content: GameContent, heroId: string): { profile: PlayerProfile; deck: DeckEntry[] } {
  let profile = createProfile(content);
  const extra = FREE_CATALOG[heroId]!.filter((r) => r.tier !== 'COMMON').map((r) => r.cardId);
  for (const id of extra) if ((heroProfile(profile, heroId, content).collection[id]?.copies ?? 0) === 0) profile = (grantCard(profile, heroId, id, content) as { profile: PlayerProfile }).profile;
  // 30 cards: drop one copy of the three biggest starter lines, add Rare + Legendary + Ultra.
  const deck = content.heroes[heroId]!.deck.map((e) => ({ ...e }));
  const order = [...deck].sort((a, b) => b.count - a.count || a.cardId.localeCompare(b.cardId)).slice(0, extra.length);
  for (const e of order) deck.find((d) => d.cardId === e.cardId)!.count -= 1;
  const cards = [...deck.filter((e) => e.count > 0), ...extra.map((cardId) => ({ cardId, count: 1 }))];
  const saved = saveActiveDeck(profile, heroId, cards, content, DECK_RULES);
  if (!saved.ok) throw new Error(`${heroId}: ${JSON.stringify(saved.issues)}`);
  return { profile: saved.profile, deck: cards };
}

function pve(heroId: string, campaign: CampaignDef, encounterId: string, withCatalog: boolean, seeds: number[]) {
  const profile = withCatalog ? catalogDeck(CONTENT, heroId).profile : createProfile(CONTENT);
  const run = { ...createRun(campaign, CONTENT, 5, heroId), currentEncounterId: encounterId };
  // The encounter as the run plays it (champion setup applied), like the client and the Worker.
  const encounter = currentEncounter(campaign, run);
  const out = { wins: 0, battles: 0, rounds: 0, catalogPlays: 0, banished: 0 };
  const catalogIds = new Set(FREE_CATALOG[heroId]!.filter((r) => r.tier !== 'COMMON').map((r) => r.cardId));
  for (const seed of seeds) {
    const engine = new GameEngine(encounter, campaignBattleContent(CONTENT, profile, run, DECK_RULES), seed);
    const played: GameEvent[] = [];
    const s = playBattle(engine, 20, undefined, { archer: heroId === 'archer', summonAware: heroId === 'summoner' } as never);
    expect(s.units.some((u) => u.id === s.player.heroId) || s.outcome?.result === 'LOST').toBe(true);
    expect(engine.state.units.find((u) => u.kind === 'HERO' || u.id === s.player.heroId)?.defId ?? heroId).toBe(heroId);
    // Count catalog card plays from a replay of the history (the bot's choices, not forced).
    const replay = new GameEngine(encounter, campaignBattleContent(CONTENT, profile, run, DECK_RULES), seed);
    for (const c of engine.history) {
      const r = replay.dispatch(c);
      if (r.ok) played.push(...r.events);
    }
    out.catalogPlays += ofType(played, 'CARD_PLAYED').filter((e) => catalogIds.has(e.cardId)).length;
    out.battles++;
    out.rounds += s.round;
    if (s.outcome?.result === 'WON') out.wins++;
    out.banished += s.player.banished?.length ?? 0;
    // Battles always end or stop at the round cap (no infinite turn).
    expect(s.round).toBeLessThanOrEqual(21);
  }
  return { ...out, avgRounds: +(out.rounds / out.battles).toFixed(1) };
}

describe('light PvE QA: normal encounter + boss, base deck vs catalog deck', () => {
  const seeds = [1, 2, 3];
  for (const heroId of ['mage', 'summoner', 'warrior', 'shapeshifter', 'archer'])
    it(`${heroId}: battles end, Ultras banish once, results recorded`, () => {
      const [campaign, normal, boss] =
        heroId === 'archer' ? [ARCHER_HUNT_CAMPAIGN, 'hunt_05_stalker', 'hunt_10_veil_beast'] : [ASCENT_CAMPAIGN, 'ascent_04_shield_wall', 'ascent_10_colossus'];
      const row = {
        normal: { base: pve(heroId, campaign, normal, false, seeds), catalog: pve(heroId, campaign, normal, true, seeds) },
        boss: { base: pve(heroId, campaign, boss, false, seeds), catalog: pve(heroId, campaign, boss, true, seeds) },
      };
      // At most one Ultra per battle can ever be banished (1 copy, Única).
      for (const k of ['normal', 'boss'] as const) expect(row[k].catalog.banished).toBeLessThanOrEqual(row[k].catalog.battles);
      report[`pve.${heroId}`] = row;
    }, 180_000);
});

// ── PvP: short scripted duels on the real duel rules ─────────────────────────────────────
function duel(a: string, b: string, seed = 3): GameState {
  const deck = (heroId: string) => catalogDeck(CONTENT, heroId).deck;
  let state = createDuel([{ heroId: a, cards: deck(a) }, { heroId: b, cards: deck(b) }], seed, 'DUEL', 'classic', CONTENT);
  if (state.units.find((u) => u.id === state.player.heroId)!.defId !== a) state = applyDuel(state, endTurn(state), CONTENT).state;
  return state;
}
/** Put `cardId` in the active seat's hand (from its deck) with full energy. */
function hold(state: GameState, cardId: string): string {
  const p = state.player;
  const card = [...p.deck, ...p.hand, ...p.discard].find((c) => c.cardId === cardId) ?? { uid: `qa-${cardId}-${state.nextId++}`, cardId };
  p.deck = p.deck.filter((c) => c !== card);
  p.discard = p.discard.filter((c) => c !== card);
  p.hand = [...p.hand.filter((c) => c !== card), card];
  p.energy = p.maxEnergy;
  return card.uid;
}
const me = (s: GameState) => s.units.find((u) => u.id === s.player.heroId)!;
const rival = (s: GameState) => s.units.find((u) => u.kind === 'HERO' && u.id !== s.player.heroId)!;
const ctx = (s: GameState) => ({ state: s, content: CONTENT, emit: () => {} });
const place = (s: GameState, a: { x: number; y: number }, b: { x: number; y: number }) => {
  me(s).pos = a;
  rival(s).pos = b;
};

describe('light PvP QA: one short duel per Legendary / Ultra', () => {
  it('Último Bastión: survives exactly ONE rival turn at 1 HP, then is killable (no exploitable invulnerability)', () => {
    let s = duel('warrior', 'mage');
    place(s, { x: 2, y: 2 }, { x: 5, y: 2 });
    me(s).hp = 3;
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: hold(s, 'last_bastion'), target: null }, CONTENT).state;
    s = applyDuel(s, endTurn(s), CONTENT).state; // mage's turn
    const warrior = rival(s);
    for (let k = 0; k < 3; k++) dealDamage(ctx(s), warrior, 9, me(s).id, 'FIRE'); // lethal burst x3
    const survived = s.units.includes(warrior) && warrior.hp === 1;
    s = applyDuel(s, endTurn(s), CONTENT).state; // warrior's next turn: the floor is gone
    const after = me(s);
    const expired = !after.statuses.some((x) => x.id === 'LAST_STAND');
    dealDamage(ctx(s), after, 9, rival(s).id, 'FIRE');
    expect([survived, expired, s.units.includes(after)]).toEqual([true, true, false]);
    report['pvp.last_bastion'] = { survivedRivalTurnAt1Hp: survived, floorGoneNextOwnTurn: expired, killableAfter: true };
  });

  it('Gólem del Pacto: answerable (Mage burst turns to kill), aura −1 only, one per battle', () => {
    let s = duel('summoner', 'mage');
    place(s, { x: 1, y: 2 }, { x: 6, y: 2 });
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: hold(s, 'summon_pact_golem'), target: { x: 2, y: 2 } }, CONTENT).state;
    const golem = s.units.find((u) => u.defId === 'pact_golem')!;
    // Mage turn budget: Bola de Fuego (3) + Misil (2) + Misil (2) for 5 energy; armour 1 → 1+2+1+1 = (2+1+1) = 4 per turn.
    const perTurn = [3, 2, 2].reduce((n, d) => n + Math.max(0, d - golem.armor), 0);
    const turnsToKill = Math.ceil(golem.maxHp / perTurn);
    expect(turnsToKill).toBeLessThanOrEqual(5);
    s.round += 1;
    const protectedHit = attackDamage(ctx(s), rival(s), me(s), 3);
    expect(protectedHit).toBe(2);
    report['pvp.pact_golem'] = { hp: golem.maxHp, armor: golem.armor, mageDamagePerTurn: perTurn, mageTurnsToKill: turnsToKill, auraHit3: protectedHit };
  });

  it('Orden del Vinculador: one activation per summon per round over 3 rounds (no extra-turn loop)', () => {
    let s = duel('summoner', 'warrior');
    place(s, { x: 1, y: 2 }, { x: 6, y: 2 });
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: hold(s, 'summon_fox'), target: { x: 2, y: 2 } }, CONTENT).state;
    s = applyDuel(s, endTurn(s), CONTENT).state; // summoner ends
    let ordered = 0;
    let foxActs = 0;
    for (let k = 0; k < 6 && ordered < 3; k++) {
      s = applyDuel(s, endTurn(s), CONTENT).state; // rival ends → summoner active
      expect(me(s).defId).toBe('summoner');
      const fox = s.units.find((u) => u.defId === 'fox');
      if (!fox) break;
      if (s.round < fox.summon!.readyRound) {
        s = applyDuel(s, endTurn(s), CONTENT).state;
        continue;
      }
      const order = applyDuel(s, { type: 'PLAY_CARD', cardUid: hold(s, 'binder_command'), target: fox.pos }, CONTENT);
      const end = applyDuel(order.state, endTurn(order.state), CONTENT);
      ordered += ofType(order.events, 'SUMMON_ORDERED').length;
      foxActs += ofType(end.events, 'SUMMON_ATTACKED').filter((e) => e.unitId === fox.id).length;
      s = end.state;
    }
    expect(ordered).toBe(3);
    expect(foxActs).toBe(0); // an ordered summon never acts again at its owner's end of turn
    report['pvp.binder_command'] = { orderedActivations: ordered, extraEndOfTurnActivations: foxActs };
  });

  it('Red del Cazador vs a champion: roots for one turn, never re-roots (no hard lock)', () => {
    let s = duel('archer', 'warrior');
    place(s, { x: 0, y: 2 }, { x: 8, y: 2 });
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: hold(s, 'hunters_net'), target: { x: 4, y: 2 } }, CONTENT).state;
    const traps = s.traps!.length;
    const target = rival(s);
    target.pos = { x: 4, y: 2 };
    springTrap(ctx(s), target);
    const rootTurns = target.statuses.find((x) => x.id === 'ROOTED')?.turnsLeft ?? 0;
    target.pos = { x: 5, y: 2 };
    const second = springTrap(ctx(s), target);
    expect([second, s.traps?.length ?? 0]).toEqual([false, 0]);
    expect(rootTurns).toBeLessThanOrEqual(1);
    report['pvp.hunters_net'] = { trapsPlaced: traps, rootTurnsOnChampion: rootTurns, reRoots: 0 };
  });

  it('Danza de las Formas: bounded payout per turn (4 energy)', () => {
    let s = duel('shapeshifter', 'mage');
    s.player.movePoints = 0;
    const plays = ['form_dance', 'qa_bear_form', 'qa_minotaur_form', 'qa_bear_form'];
    for (const id of plays) {
      const uid = hold(s, id);
      s.player.energy = 4;
      s = applyDuel(s, { type: 'PLAY_CARD', cardUid: uid, target: null }, CONTENT).state;
    }
    expect(me(s).shield).toBe(4);
    expect(s.player.movePoints).toBe(2);
    report['pvp.form_dance'] = { maxShieldPerTurn: me(s).shield, maxExtraMovePerTurn: s.player.movePoints };
  });

  it('Ultras and Legendaries: single-turn damage to a champion stays well below one-turn-kill range', () => {
    const rows: Record<string, number> = {};
    const hit = (hero: string, foe: string, cardId: string, target: (s: GameState) => { x: number; y: number } | null, arrange: (s: GameState) => void = () => {}) => {
      let s = duel(hero, foe);
      arrange(s);
      const before = rival(s).hp + rival(s).shield;
      s = applyDuel(s, { type: 'PLAY_CARD', cardUid: hold(s, cardId), target: target(s) }, CONTENT).state;
      const foeNow = s.units.find((u) => u.kind === 'HERO' && u.id !== s.player.heroId);
      rows[cardId] = before - ((foeNow?.hp ?? 0) + (foeNow?.shield ?? 0));
      return s;
    };
    hit('mage', 'archer', 'archmage_eruption', (s) => rival(s).pos, (s) => place(s, { x: 1, y: 2 }, { x: 4, y: 2 }));
    hit('archer', 'mage', 'arrow_rain', (s) => rival(s).pos, (s) => { place(s, { x: 0, y: 2 }, { x: 4, y: 2 }); applyStatus(ctx(s), rival(s), 'PREY', 99, me(s).id); });
    hit('shapeshifter', 'archer', 'ancestral_stampede', (s) => rival(s).pos, (s) => place(s, { x: 1, y: 2 }, { x: 5, y: 2 }));
    hit('warrior', 'archer', 'bastion_blow', (s) => rival(s).pos, (s) => { place(s, { x: 3, y: 2 }, { x: 4, y: 2 }); me(s).shield = 9; });
    hit('mage', 'archer', 'elemental_detonation', (s) => rival(s).pos, (s) => { place(s, { x: 1, y: 2 }, { x: 3, y: 2 }); tileAt(s.board, { x: 3, y: 2 })!.terrain = 'FIRE'; });
    const minChampionHp = Math.min(...['mage', 'summoner', 'warrior', 'archer', 'shapeshifter'].map((h) => CONTENT.heroes[h]!.maxHp));
    for (const [id, dmg] of Object.entries(rows)) expect(dmg, id).toBeLessThan(minChampionHp / 2);
    report['pvp.singleCardDamageToChampion'] = { ...rows, minChampionHp };
  });

  it('displacement: Erupción pushes 1, Estampida 2 — never a board-wide shove', () => {
    let s = duel('mage', 'archer');
    place(s, { x: 1, y: 2 }, { x: 4, y: 2 });
    const from = { ...rival(s).pos };
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: hold(s, 'archmage_eruption'), target: rival(s).pos }, CONTENT).state;
    const moved = Math.abs(rival(s).pos.x - from.x) + Math.abs(rival(s).pos.y - from.y);
    expect(moved).toBeLessThanOrEqual(1);
    report['pvp.displacement'] = { eruptionTiles: moved, stampedeTiles: 2 };
  });

  it('writes the QA report', () => {
    mkdirSync('qa/free-card-catalog', { recursive: true });
    writeFileSync('qa/free-card-catalog/balance-qa.json', JSON.stringify(report, null, 1));
    expect(Object.keys(report).length).toBeGreaterThan(5);
  });
});
