import { beforeEach, describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  INFERNAL_CAMPAIGN,
  campaignBattleContent,
  cardSource,
  claimReward,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  encounterOrder,
  GameEngine,
  isExclusiveCard,
  parseRunSave,
  rollReward,
  serializeRun,
  settleVictory,
  validateWorlds,
  worldContext,
  worldsView,
  WORLD_3,
  WORLD_3_FLAG,
  type GameContent,
  type PlayerProfile,
  type RunState,
  type VictoryProof,
  type WorldView,
} from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { TEMPLE_CAMPAIGN, TEMPLE_ENCOUNTERS } from '../src/game/data/temple-encounters';
import { TEMPLE_COMPLETION_CARD_BY_CHAMPION, TEMPLE_ENCOUNTER_CARDS, TEMPLE_REWARD_CARDS } from '../src/game/data/temple-rewards';
import { ASCENT_CRYSTAL_MILESTONES, TEMPLE_CRYSTAL_MILESTONES } from '../src/game/store/freeEconomy';
import { WORLD_2 } from '../src/game/data/worlds';
import { executeCommand, type Command } from '../src/game/engine/commands';
import { replayBattle } from '../src/game/engine/replay';
import { encounterFor, validateCampaign } from '../src/game/run/encounter';
import { isCardForHero } from '../src/game/collection/deck-rules';
import { queryContext } from '../src/game/domain/context';
import { canEnter } from '../src/game/domain/board/occupancy';
import { posKey, samePos, type Pos } from '../src/game/domain/core/position';
import { createMechanismBoard, mechanismById } from '../src/game/domain/mechanisms/mechanism-board';
import { rotateSection, safeRepeatableControl } from '../src/game/domain/mechanisms/mechanism-rules';
import { mechanismView } from '../src/game/domain/mechanisms/mechanism-view';
import { fallbackDiscardUid } from '../src/game/domain/cards/hand-limit';
import type { GameState } from '../src/game/domain/state';
import type { MechanismBoardDef } from '../src/game/domain/mechanisms/mechanism';
import { handle } from '../server/src/index';
import { creditedRewards, victoryCrystalStatements } from '../server/src/economy';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';
import { puzzleOnly, ROUTES, runRoute } from './support/act3-pilot';
import { mutable, ofType, setHand } from './helpers';

const CONTENT = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const HEROES = TEMPLE_CAMPAIGN.heroIds;
const p = (x: number, y: number): Pos => ({ x, y });
const engineFor = (id: string, heroId = 'mage', seed?: number) => new GameEngine(encounterFor(TEMPLE_CAMPAIGN, id, heroId), CONTENT, seed);
const endTurn = (state: Readonly<GameState>): Command => {
  const discardUid = fallbackDiscardUid(state);
  return discardUid ? { type: 'END_TURN', discardUid } : { type: 'END_TURN' };
};
const apply = (state: GameState, command: Command): GameState | null => {
  const draft = structuredClone(state);
  return executeCommand({ state: draft, content: CONTENT, emit: () => {} }, command).ok ? draft : null;
};
const heroOf = (s: Readonly<GameState>) => s.units.find((u) => u.id === s.player.heroId)!;
const DIRS = [p(1, 0), p(-1, 0), p(0, 1), p(0, -1)];
/** Tiles the champion can walk to from where it stands (ignores MP: a structural question). */
function flood(state: GameState): Set<string> {
  const ctx = queryContext(state, CONTENT);
  const hero = heroOf(state);
  const seen = new Set([posKey(hero.pos)]);
  const queue = [hero.pos];
  while (queue.length) {
    const at = queue.shift()!;
    for (const d of DIRS) {
      const to = p(at.x + d.x, at.y + d.y);
      if (seen.has(posKey(to)) || !canEnter(ctx, to, hero.id)) continue;
      seen.add(posKey(to));
      queue.push(to);
    }
  }
  return seen;
}

// ── Act III: one act of ten ──────────────────────────────────────────────────────────────────
describe('Act III — ten encounters, one act (World 3)', () => {
  it('XXI–XXX chained in order, every champion, every encounter valid', () => {
    expect(encounterOrder(TEMPLE_CAMPAIGN).map((e) => e.id)).toEqual(['w3_e01', 'w3_e02', 'w3_e03', 'w3_e04', 'w3_e05', 'w3_e06', 'w3_e07', 'w3_e08', 'w3_e09', 'w3_e10']);
    expect(TEMPLE_ENCOUNTERS.map((e) => e.name.split(' · ')[0])).toEqual(['XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX']);
    expect(TEMPLE_ENCOUNTERS.map((e) => e.tier)).toEqual(['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'ELITE', 'NORMAL', 'NORMAL', 'NORMAL', 'ELITE', 'BOSS']);
    expect(HEROES).toEqual(['mage', 'summoner', 'warrior', 'shapeshifter', 'archer']);
    expect(validateCampaign(TEMPLE_CAMPAIGN, CONTENT)).toEqual([]);
    // Every encounter is a mechanism board: the act's identity is the board itself.
    for (const e of TEMPLE_ENCOUNTERS) expect(e.mechanisms, e.id).toBeDefined();
  });

  it('is World 3 of the main acts, behind WORLD_3 (hidden by default), unlocked by World 2', () => {
    expect(WORLD_3).toMatchObject({ id: 'world_3', order: 3, campaignId: 'temple', bossEncounterId: 'w3_e10', releaseFlag: WORLD_3_FLAG, unlock: { type: 'WORLD_COMPLETED', worldId: 'world_2' } });
    expect(WORLD_3.encounterIds).toHaveLength(10);
    expect(WORLD_3.presentation.firstEncounterNumber).toBe(21);
    expect(validateWorlds(worldContext(() => true), CONTENT).filter((e) => e.includes('world_3') || e.includes('w3_') || e.includes('temple'))).toEqual([]);
    // Hidden: absent from a caller who has not released it.
    expect(worldsView(worldContext(() => false), {}, {}, 'mage').some((w) => w.id === 'world_3')).toBe(false);
    const open = worldsView(worldContext(() => true), {}, {}, 'mage');
    expect(open.find((w) => w.id === 'world_3')).toMatchObject({ status: 'LOCKED', totalEncounters: 10 });
  });

  it('existing saves survive: a run parked at XXVI (old six-encounter chain) loads and continues into XXVII', () => {
    const run: RunState = { ...createRun(TEMPLE_CAMPAIGN, CONTENT, 4, 'warrior'), completedEncounterIds: ['w3_e01', 'w3_e02', 'w3_e03', 'w3_e04', 'w3_e05'], currentEncounterId: 'w3_e06' };
    const loaded = parseRunSave(serializeRun(run), TEMPLE_CAMPAIGN, CONTENT);
    expect(loaded.status).toBe('OK');
    const won = settleVictory(TEMPLE_CAMPAIGN, CONTENT, createProfile(CONTENT), run, 'w3_e06', DECK_RULES);
    if (!won.ok) throw new Error(won.error);
    const option = won.run.rewardOptions[0]!;
    expect(option).toMatchObject({ kind: 'ADD_CARD', cardId: 'broken_seal' });
    const claimed = claimReward(TEMPLE_CAMPAIGN, CONTENT, won.profile, won.run, option.id);
    if (!claimed.ok) throw new Error(claimed.error);
    expect(claimed.run).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: 'w3_e07' });
  });

  it('known routes win (puzzle-only) for every champion: XXVII, XXVIII, XXIX', () => {
    for (const id of ['w3_e07', 'w3_e08', 'w3_e09'])
      for (const heroId of HEROES) expect(runRoute(engineFor(id, heroId), ROUTES[id]!).result, `${id} ${heroId}`).toBe('WON');
  });
});

// ── XXV: the Guardian's lever moves ─────────────────────────────────────────────────────────
/** XXV with a sturdy champion and a Guardian rooted in a corner (it still exists: plating rules need it). */
function guardianLab(heroId = 'mage', seed = 305) {
  const e = engineFor('w3_e05', heroId, seed);
  const s = mutable(e);
  const guardian = s.units.find((u) => u.id === 'guardian')!;
  guardian.pos = p(0, 5);
  guardian.moveRange = 0;
  s.pendingWaves = [];
  const hero = heroOf(s);
  hero.maxHp = hero.hp = 999;
  return e;
}
const live = (e: GameEngine) => e.getMechanismView()!.rings[0]!.live;
const placeHero = (e: GameEngine, at: Pos) => {
  heroOf(mutable(e)).pos = at;
};
/** Statue onto the plate from (4,5) (a real INTERACT), then end the turn. */
function weighPlate(e: GameEngine) {
  placeHero(e, p(4, 5));
  expect(e.dispatch({ type: 'INTERACT', mechanismId: 'statue' }).ok).toBe(true);
  expect(mechanismById(e.state, 'plate')!.active).toBe(true);
}
const LEVER_TILES: Record<string, Pos> = { 'lever-a': p(3, 1), 'lever-b': p(7, 2), 'lever-c': p(5, 4) };
/** Pull `id` from its tile and run the 3-round window out; returns every event of its END_TURNs. */
function openWindow(e: GameEngine, id: string) {
  placeHero(e, LEVER_TILES[id]!);
  const pulled = e.dispatch({ type: 'INTERACT', mechanismId: id });
  expect(pulled.ok, id).toBe(true);
  expect(ofType(pulled.events, 'GUARDIAN_STATE').map((g) => g.cue)).toEqual(['GUARDIAN_EXPOSED']);
  // Inside the window: the used lever is dark, the next one has NOT woken, nothing relocated.
  expect(mechanismById(e.state, id)!.locked).toBe(true);
  expect(e.dispatch({ type: 'INTERACT', mechanismId: id }).ok).toBe(false);
  const inside = [e.dispatch(endTurn(e.state)), e.dispatch(endTurn(e.state))];
  for (const r of inside) expect(ofType(r.events, 'MECHANISM_CHANGED').some((c) => c.cue === 'CONTROL_RELOCATED')).toBe(false);
  expect(e.getMechanismView()!.guardians[0]!.state).toBe('EXPOSED');
  expect(live(e)).toBe(id);
  const closing = e.dispatch(endTurn(e.state));
  return [...inside.flatMap((r) => r.events), ...closing.events];
}

describe('XXV «Guardián Mecánico» — the core relocates its lever', () => {
  it('A → B → C → A, each move only after the core closes; exposure cycle counted', () => {
    const e = guardianLab();
    expect(live(e)).toBe('lever-a');
    expect(['lever-b', 'lever-c'].map((id) => mechanismById(e.state, id)!.locked)).toEqual([true, true]);
    weighPlate(e);
    e.dispatch(endTurn(e.state));
    const expected: [string, string, Pos][] = [
      ['lever-a', 'lever-b', p(3, 0)],
      ['lever-b', 'lever-c', p(8, 2)],
      ['lever-c', 'lever-a', p(5, 5)],
    ];
    expected.forEach(([from, to, oldPos], k) => {
      const events = openWindow(e, from);
      const order = events.flatMap((ev) => (ev.type === 'GUARDIAN_STATE' ? [ev.cue] : ev.type === 'MECHANISM_CHANGED' && ev.cue === 'CONTROL_RELOCATED' ? ['RELOCATED'] : []));
      // The core closes (plating back) BEFORE the control moves.
      expect(order).toEqual(['GUARDIAN_REFORTIFIED', 'RELOCATED']);
      const cue = ofType(events, 'MECHANISM_CHANGED').find((c) => c.cue === 'CONTROL_RELOCATED')!;
      expect(cue).toMatchObject({ mechanismId: to, causeId: from, from: oldPos });
      expect(live(e)).toBe(to);
      expect(mechanismById(e.state, from)!.locked).toBe(true);
      expect(mechanismById(e.state, to)!.locked).toBeUndefined();
      expect(e.state.mechanisms!.exposureCycles).toEqual({ guardian: k + 1 });
      expect(e.getMechanismView()!.rings[0]!.cycle).toBe(k + 1);
      expect(e.getMechanismView()!.guardians[0]!.state).toBe('FORTIFIED');
    });
    expect(e.state.mechanisms!.cycles).toEqual({ 'lever-a+lever-b+lever-c': 0 });
  });

  it('a dormant lever refuses INTERACT; pulling the live one without the plate opens nothing and moves nothing', () => {
    const e = guardianLab();
    placeHero(e, LEVER_TILES['lever-b']!);
    expect(e.dispatch({ type: 'INTERACT', mechanismId: 'lever-b' }).ok).toBe(false);
    placeHero(e, LEVER_TILES['lever-a']!);
    const r = e.dispatch({ type: 'INTERACT', mechanismId: 'lever-a' });
    expect(r.ok).toBe(true);
    expect(ofType(r.events, 'GUARDIAN_STATE')).toEqual([]);
    e.dispatch(endTurn(e.state));
    e.dispatch(endTurn(e.state));
    expect(live(e)).toBe('lever-a'); // no window → no relocation; the lever simply timed out
    expect(mechanismById(e.state, 'lever-a')!.state).toBe('OFF');
  });

  it('blocked candidate fallback: B walled in by units is skipped (A → C); everything blocked → A re-arms', () => {
    const e = guardianLab();
    weighPlate(e);
    e.dispatch(endTurn(e.state));
    const s = mutable(e);
    // Surround lever B (8,2): (8,1), (8,3), (7,2) — three orcs.
    const orc = s.units.find((u) => u.id === 'guardian')!;
    for (const [k, at] of [p(8, 1), p(8, 3), p(7, 2)].entries()) s.units.push({ ...structuredClone(orc), id: `wall-${k}`, defId: 'orc_warrior', pos: at, moveRange: 0, statuses: [] });
    const events = openWindow(e, 'lever-a');
    expect(ofType(events, 'MECHANISM_CHANGED').find((c) => c.cue === 'CONTROL_RELOCATED')).toMatchObject({ mechanismId: 'lever-c', causeId: 'lever-a' });
    expect(live(e)).toBe('lever-c');
    // Now block every other candidate (A and B): C re-arms in place.
    for (const [k, at] of [p(2, 0), p(4, 0), p(3, 1)].entries()) mutable(e).units.push({ ...structuredClone(orc), id: `wall-a-${k}`, defId: 'orc_warrior', pos: at, moveRange: 0, statuses: [] });
    const again = openWindow(e, 'lever-c');
    expect(ofType(again, 'MECHANISM_CHANGED').some((c) => c.cue === 'CONTROL_RELOCATED')).toBe(false);
    expect(live(e)).toBe('lever-c');
    expect(mechanismById(e.state, 'lever-c')!.locked).toBeUndefined();
  });

  it('every lever is reachable by every champion: pedestals on open floor, never on a unit, no ranged use', () => {
    const levers = ['lever-a', 'lever-b', 'lever-c'];
    for (const heroId of HEROES) {
      const s = puzzleOnly(engineFor('w3_e05', heroId).state);
      const reach = flood(s);
      for (const id of levers) {
        const o = mechanismById(s, id)!;
        expect(DIRS.some((d) => reach.has(posKey(p(o.pos.x + d.x, o.pos.y + d.y)))), `${heroId} ${id}`).toBe(true);
        expect(s.units.some((u) => samePos(u.pos, o.pos))).toBe(false);
      }
    }
    // INTERACT is orthogonally adjacent only (no range): the Archer walks like everyone else.
    const e = guardianLab('archer');
    placeHero(e, p(2, 2));
    expect(e.dispatch({ type: 'INTERACT', mechanismId: 'lever-a' }).ok).toBe(false);
  });

  it('every champion completes three windows A → B → C following the live lever (puzzle route)', () => {
    for (const heroId of HEROES) {
      const e = guardianLab(heroId);
      weighPlate(e);
      e.dispatch(endTurn(e.state));
      for (const id of ['lever-a', 'lever-b', 'lever-c']) {
        expect(live(e), heroId).toBe(id);
        openWindow(e, id);
      }
      expect(live(e)).toBe('lever-a');
    }
  });

  it('replay: the same commands rebuild the exact live lever, cycle and lever states', () => {
    const e = engineFor('w3_e05', 'warrior', 305);
    // Real commands only: walk to the statue, push, walk to A, pull, ride out the window.
    const plan: Command[] = [];
    const run = (c: Command) => {
      const r = e.dispatch(c);
      if (r.ok) plan.push(c);
      return r.ok;
    };
    run({ type: 'MOVE_UNIT', unitId: 'warrior', to: p(4, 5) });
    run({ type: 'INTERACT', mechanismId: 'statue' });
    for (let turn = 0; turn < 8 && !e.state.outcome; turn++) {
      const id = live(e);
      const at = LEVER_TILES[id]!;
      run({ type: 'MOVE_UNIT', unitId: 'warrior', to: at });
      run({ type: 'INTERACT', mechanismId: id });
      run(endTurn(e.state));
    }
    const replayed = replayBattle(encounterFor(TEMPLE_CAMPAIGN, 'w3_e05', 'warrior'), CONTENT, 305, e.history);
    expect(replayed.rejectedAt).toBeNull();
    expect(replayed.state.mechanisms).toEqual(e.state.mechanisms);
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(e.state));
  });

  it('reconnect: a snapshot restores the live lever exactly and continues identically', () => {
    const e = guardianLab();
    weighPlate(e);
    e.dispatch(endTurn(e.state));
    openWindow(e, 'lever-a');
    const copy = GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)) as GameState, e.content, e.scenario);
    expect(copy.getMechanismView()!.rings).toEqual(e.getMechanismView()!.rings);
    expect(copy.state.mechanisms!.cycles).toEqual({ 'lever-a+lever-b+lever-c': 1 });
    for (const engine of [e, copy]) openWindow(engine, 'lever-b');
    expect(JSON.stringify(copy.state)).toBe(JSON.stringify(e.state));
    expect(live(copy)).toBe('lever-c');
  });
});

// ── XXVII ───────────────────────────────────────────────────────────────────────────────────
describe('XXVII «Peso y Contrapeso»', () => {
  it('the champion can never be its own weight: the plate lies behind the counterweight', () => {
    for (const heroId of HEROES) expect(flood(puzzleOnly(engineFor('w3_e07', heroId).state)).has(posKey(p(6, 4))), heroId).toBe(false);
  });

  it('weight sends the Balanza north with its rider: the north route opens, the south one closes', () => {
    const e = engineFor('w3_e07', 'archer');
    const s = puzzleOnly(e.state);
    heroOf(s).pos = p(4, 4);
    const after = apply(s, { type: 'INTERACT', mechanismId: 'statue' })!;
    expect(mechanismById(after, 'balance')!.stop).toBe('north');
    expect(heroOf(after).pos).toEqual(p(4, 1));
    const ctx = queryContext(after, CONTENT);
    expect(canEnter(ctx, p(4, 4))).toBe(false); // south slot is abyss again
    expect(flood(after).has(posKey(p(8, 0)))).toBe(true);
  });

  it('a Summoner can be the weight with a summon; if it falls the Balanza returns south and nobody is stranded', () => {
    const e = engineFor('w3_e07', 'summoner');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY');
    s.pendingWaves = [];
    heroOf(s).pos = p(4, 4);
    s.player.energy = 9;
    const [uid] = setHand(e, ['summon_fox']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(6, 4) }).ok).toBe(true);
    expect(mechanismById(e.state, 'balance')!.stop).toBe('north');
    expect(heroOf(e.state).pos).toEqual(p(4, 1));
    // The champion steps into the exit pocket; then the summon-weight is lost.
    const copy = structuredClone(e.state) as GameState;
    heroOf(copy).pos = p(6, 1);
    copy.units = copy.units.filter((u) => u.kind !== 'SUMMON');
    const settled = apply(copy, endTurn(copy))!;
    expect(mechanismById(settled, 'balance')!.stop).toBe('south');
    expect(flood(settled).has(posKey(p(8, 0)))).toBe(true);
  });
});

// ── XXIX ───────────────────────────────────────────────────────────────────────────────────
/** Exhaustive puzzle graph over (orientation, champion tile, wall state): steps and free control pulls. */
function heartGraph(heroId: string, start: (s: GameState) => GameState) {
  const s0 = start(puzzleOnly(engineFor('w3_e09', heroId).state));
  const key = (s: GameState) => `${mechanismById(s, 'heart-section')!.state}|${mechanismById(s, 'wall')!.state}@${posKey(heroOf(s).pos)}`;
  const nodes = new Map<string, GameState>([[key(s0), s0]]);
  const edges = new Map<string, string[]>();
  const queue = [s0];
  while (queue.length) {
    const s = queue.shift()!;
    const out: string[] = [];
    const hero = heroOf(s);
    const ctx = queryContext(s, CONTENT);
    const nexts: GameState[] = [];
    for (const d of DIRS) {
      const to = p(hero.pos.x + d.x, hero.pos.y + d.y);
      if (!canEnter(ctx, to, hero.id)) continue;
      const next = structuredClone(s);
      heroOf(next).pos = to;
      nexts.push(next);
    }
    for (const control of ['lever', 'console']) {
      const next = apply(s, { type: 'INTERACT', mechanismId: control });
      if (next) nexts.push(next);
    }
    for (const next of nexts) {
      out.push(key(next));
      if (!nodes.has(key(next))) {
        nodes.set(key(next), next);
        queue.push(next);
      }
    }
    edges.set(key(s), out);
  }
  return { nodes, edges };
}
const reaches = (g: ReturnType<typeof heartGraph>, from: string, goal: (k: string) => boolean) => {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const k = queue.shift()!;
    if (goal(k)) return true;
    for (const t of g.edges.get(k) ?? [])
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
  }
  return false;
};

describe('XXIX «El Corazón del Templo»', () => {
  it('the controls stay FREE under the narrow rule (plate and wall stand where the section never reaches)', () => {
    const b = engineFor('w3_e09').state.mechanisms!;
    expect(safeRepeatableControl(b, 'console')).toBe(true);
    expect(safeRepeatableControl(b, 'lever')).toBe(true);
    // Same board with a spawn trap INSIDE the section: turning could fire it → fail closed.
    const def = encounterFor(TEMPLE_CAMPAIGN, 'w3_e09', 'mage').mechanisms!;
    const unsafe: MechanismBoardDef = {
      objects: [...def.objects, { id: 'rune', kind: 'TRAP', pos: { x: 4, y: 3 }, trap: { damage: 1, damageType: 'ARCANE' } }],
      rules: [...def.rules, { id: 'ambush', trigger: { type: 'ON_ENTER_TILE', sources: ['rune'] }, actions: [{ type: 'SPAWN', enemies: [{ id: 'x', enemyId: 'orc_warrior', pos: { x: 0, y: 0 } }] }] }],
    };
    expect(safeRepeatableControl(createMechanismBoard(unsafe), 'console')).toBe(false);
    // A free pull never spends the turn's interaction: push the statue AND turn the section in one turn.
    const e = engineFor('w3_e09');
    placeHeroOn(e, p(1, 2));
    for (let k = 0; k < 3; k++) expect(e.dispatch({ type: 'INTERACT', mechanismId: 'lever' }).ok).toBe(true);
    placeHeroOn(e, p(1, 4));
    expect(e.dispatch({ type: 'INTERACT', mechanismId: 'statue' }).ok).toBe(true);
    expect(mechanismById(e.state, 'wall')!.state).toBe('OPEN');
  });

  it('the east door needs 180°: at 90° the console itself blocks it (minimum two pulls)', () => {
    const s = puzzleOnly(engineFor('w3_e09').state);
    mechanismById(s, 'statue')!.pos = p(1, 6);
    heroOf(s).pos = p(5, 2);
    const at90 = apply(apply(s, endTurn(s))!, { type: 'INTERACT', mechanismId: 'console' })!;
    expect(mechanismById(at90, 'console')!.pos).toEqual(p(7, 3));
    expect(flood(at90).has(posKey(p(9, 3)))).toBe(false);
    const at180 = apply(at90, { type: 'INTERACT', mechanismId: 'console' })!;
    expect(flood(at180).has(posKey(p(9, 3)))).toBe(true);
  });

  it('no softlock: from every reachable state the Heart stays reachable (wall open) and the plate side stays reachable (wall shut)', () => {
    for (const heroId of ['mage', 'archer']) {
      const open = heartGraph(heroId, (s) => {
        const statue = mechanismById(s, 'statue')!;
        statue.pos = p(1, 6);
        return apply(s, endTurn(s))!;
      });
      expect(open.nodes.size).toBeGreaterThan(40);
      for (const k of open.nodes.keys()) expect(reaches(open, k, (x) => x.endsWith('@9,3')), `${heroId} ${k}`).toBe(true);
      const shut = heartGraph(heroId, (s) => s);
      for (const k of shut.nodes.keys()) expect(reaches(shut, k, (x) => x.endsWith('@1,4')), `${heroId} ${k}`).toBe(true);
    }
  });
});
function placeHeroOn(e: GameEngine, at: Pos) {
  heroOf(mutable(e)).pos = at;
}

// ── XXX ────────────────────────────────────────────────────────────────────────────────────
function architectLab(heroId = 'mage', seed = 310) {
  const e = engineFor('w3_e10', heroId, seed);
  const s = mutable(e);
  s.units = s.units.filter((u) => u.kind !== 'ENEMY' || u.id === 'architect');
  s.pendingWaves = [];
  const hero = heroOf(s);
  hero.maxHp = hero.hp = 999;
  return e;
}

describe('XXX «El Arquitecto del Umbral» — the boss rebuilds the board, always telegraphed', () => {
  it('telegraph: the view lists each scheduled change a round ahead, with its label and actor', () => {
    const e = architectLab();
    const view = e.getMechanismView()!;
    expect(view.scheduled.map((x) => [x.ruleId, x.round, x.actorId])).toEqual([
      ['architect-turns', 2, 'architect'],
      ['architect-walls', 3, 'architect'],
    ]);
    expect(view.scheduled[0]!.label).toContain('girará');
    expect(view.scheduled[0]!.actions).toEqual([{ type: 'ROTATE', targets: ['sanctum'], turns: 1 }]);
  });

  it('end of round 2: the sanctum turns (keys and pillars ride); end of round 3: the walls swap', () => {
    const e = architectLab();
    e.dispatch(endTurn(e.state));
    expect(mechanismById(e.state, 'sanctum')!.state).toBe('ORIENTATION_0');
    const r2 = e.dispatch(endTurn(e.state));
    expect(ofType(r2.events, 'MECHANISM_CHANGED').find((c) => c.cue === 'SECTION_ROTATED')).toMatchObject({ mechanismId: 'sanctum' });
    expect(mechanismById(e.state, 'sanctum')!.state).toBe('ORIENTATION_90');
    expect(mechanismById(e.state, 'key-a')!.pos).toEqual(p(7, 3));
    expect(mechanismById(e.state, 'key-b')!.pos).toEqual(p(3, 3));
    expect(e.getMechanismView()!.scheduled.map((x) => [x.ruleId, x.round])).toEqual([
      ['architect-walls', 3],
      ['architect-turns', 4],
    ]);
    e.dispatch(endTurn(e.state));
    expect([mechanismById(e.state, 'wall-n')!.state, mechanismById(e.state, 'wall-s')!.state]).toEqual(['CLOSED', 'OPEN']);
  });

  it('the live Key exposes the Architect 3 rounds, goes dark, and the other Key wakes when the plating returns', () => {
    const e = architectLab('warrior');
    placeHeroOn(e, p(5, 2));
    const pulled = e.dispatch({ type: 'INTERACT', mechanismId: 'key-a' });
    expect(ofType(pulled.events, 'GUARDIAN_STATE').map((g) => g.cue)).toEqual(['GUARDIAN_EXPOSED']);
    expect(e.getMechanismView()!.guardians).toEqual([{ unitId: 'architect', state: 'EXPOSED', untilRound: 3 }]);
    e.dispatch(endTurn(e.state));
    e.dispatch(endTurn(e.state));
    const closing = e.dispatch(endTurn(e.state));
    expect(ofType(closing.events, 'MECHANISM_CHANGED').find((c) => c.cue === 'CONTROL_RELOCATED')).toMatchObject({ mechanismId: 'key-b', causeId: 'key-a' });
    expect(e.getMechanismView()!.rings[0]!.live).toBe('key-b');
  });

  it('every Key is reachable in every orientation, for every champion', () => {
    for (const heroId of HEROES)
      for (const orientation of [0, 90, 180, 270] as const) {
        const s = puzzleOnly(engineFor('w3_e10', heroId).state);
        rotateSection({ state: s, content: CONTENT, emit: () => {} }, 'sanctum', orientation);
        expect(mechanismById(s, 'sanctum')!.state).toBe(`ORIENTATION_${orientation}`);
        const reach = flood(s);
        for (const id of ['key-a', 'key-b']) {
          const key = mechanismById(s, id)!;
          expect(DIRS.some((d) => reach.has(posKey(p(key.pos.x + d.x, key.pos.y + d.y)))), `${heroId} ${orientation} ${id}`).toBe(true);
        }
      }
  });

  it('the board control dies with the Architect: no more turns, nothing telegraphed', () => {
    const e = architectLab();
    mutable(e).units = mutable(e).units.filter((u) => u.id !== 'architect');
    expect(e.getMechanismView()!.scheduled).toEqual([]);
  });

  it('replay and reconnect reproduce every board change of a full fight', () => {
    const e = engineFor('w3_e10', 'mage', 310);
    playBattle(e, 8, undefined, { terrainAware: true, antiStall: true });
    const replayed = replayBattle(encounterFor(TEMPLE_CAMPAIGN, 'w3_e10', 'mage'), CONTENT, 310, e.history);
    expect(replayed.rejectedAt).toBeNull();
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(e.state));
    const mid = engineFor('w3_e10', 'mage', 310);
    playBattle(mid, 4, undefined, { terrainAware: true, antiStall: true });
    const copy = GameEngine.fromSnapshot(JSON.parse(JSON.stringify(mid.state)) as GameState, mid.content, mid.scenario);
    expect(mechanismView(copy.state)).toEqual(mechanismView(mid.state));
  }, 60_000);
});

// ── Rewards ────────────────────────────────────────────────────────────────────────────────
describe('Act III rewards — table, cards, ownership, economy', () => {
  it('reward table follows the cadence: small XXII, cards XXIV/XXVI/XXVIII, elites XXV/XXIX, boss XXX', () => {
    const table = Object.fromEntries(TEMPLE_ENCOUNTERS.map((e) => [e.id, e.rewards]));
    expect(table).toEqual({
      w3_e01: { pool: 'NORMAL', choices: 3 },
      w3_e02: { pool: 'NORMAL', choices: 3 },
      w3_e03: { pool: 'NORMAL', choices: 3 },
      w3_e04: { pool: 'NORMAL', choices: 1, cards: ['threshold_step'] },
      w3_e05: { pool: 'ELITE', choices: 3 },
      w3_e06: { pool: 'NORMAL', choices: 1, cards: ['broken_seal'] },
      w3_e07: { pool: 'NORMAL', choices: 3 },
      w3_e08: { pool: 'NORMAL', choices: 1, cards: ['counterweight_rope'] },
      w3_e09: { pool: 'ELITE', choices: 3 },
      w3_e10: { pool: 'BOSS', choices: 3 },
    });
    expect(TEMPLE_CRYSTAL_MILESTONES).toEqual({ 2: 20, 5: 30, 9: 30 });
    expect(WORLD_3.completionReward).toEqual({ crystals: 170, badgeId: 'badge_temple_threshold', badgeName: 'Rompesellos del Umbral', championCards: TEMPLE_COMPLETION_CARD_BY_CHAMPION });
  });

  it('economy stays conservative: 250 crystals per champion, never above World 1 (220) or World 2 (250)', () => {
    const act3 = Object.values(TEMPLE_CRYSTAL_MILESTONES).reduce((a, b) => a + b, 0) + WORLD_3.completionReward!.crystals;
    const act1 = Object.values(ASCENT_CRYSTAL_MILESTONES).reduce((a, b) => a + b, 0);
    expect(act3).toBe(250);
    expect(act3).toBeLessThanOrEqual(Math.max(act1, WORLD_2.completionReward!.crystals));
  });

  it('8 cards: 3 neutral (every champion) + 1 per champion; exclusive, RARE/UNCOMMON, right class only', () => {
    expect(TEMPLE_REWARD_CARDS).toHaveLength(8);
    const byHero: Record<string, number> = {};
    for (const c of TEMPLE_REWARD_CARDS) byHero[c.heroId ?? 'neutral'] = (byHero[c.heroId ?? 'neutral'] ?? 0) + 1;
    expect(byHero).toEqual({ neutral: 3, mage: 1, summoner: 1, warrior: 1, archer: 1, shapeshifter: 1 });
    for (const card of TEMPLE_REWARD_CARDS) {
      expect(CONTENT.cards[card.id], card.id).toBeDefined();
      expect(isExclusiveCard(card)).toBe(true);
      expect(card.acquisition).toMatchObject({ worldId: 'world_3' });
      expect(cardSource(card)?.worldName).toBe('El Templo del Umbral');
      // Never a mechanism: only units are touched.
      expect(JSON.stringify(card.effects)).not.toMatch(/INTERACT|MECHANISM|ROTATE/);
    }
    for (const [heroId, cardId] of Object.entries(TEMPLE_COMPLETION_CARD_BY_CHAMPION)) {
      expect(CONTENT.cards[cardId]).toMatchObject({ heroId, rarity: 'RARE', acquisition: { source: 'WORLD_COMPLETION' } });
      for (const other of HEROES.filter((h) => h !== heroId)) expect(isCardForHero(CONTENT.cards[cardId]!, other)).toBe(false);
    }
    for (const cardId of Object.values(TEMPLE_ENCOUNTER_CARDS)) {
      expect(CONTENT.cards[cardId]).toMatchObject({ acquisition: { source: 'ENCOUNTER_REWARD' } });
      expect(CONTENT.cards[cardId]!.heroId).toBeUndefined();
      for (const heroId of HEROES) expect(isCardForHero(CONTENT.cards[cardId]!, heroId)).toBe(true);
    }
  });

  it('no random pool ever drops them; the authored offer gives the neutral card to every champion, once', () => {
    const ids = new Set(TEMPLE_REWARD_CARDS.map((c) => c.id));
    for (const heroId of HEROES)
      for (const poolId of ['NORMAL', 'ELITE', 'BOSS'] as const)
        for (let seed = 1; seed <= 60; seed++) {
          const roll = rollReward({ content: CONTENT, heroId, owned: () => 9, pity: 4, rules: DECK_RULES, poolId, seed, count: 3, favorTags: ['temple-reward'] });
          expect(roll.options.some((o) => o.kind === 'ADD_CARD' && ids.has(o.cardId))).toBe(false);
        }
    for (const heroId of HEROES) {
      const roll = rollReward({ content: CONTENT, heroId, owned: () => 0, pity: 0, rules: DECK_RULES, poolId: 'NORMAL', seed: 1, count: 1, authored: ['threshold_step'] });
      expect(roll.options).toEqual([{ id: 'reward-0-threshold_step', kind: 'ADD_CARD', cardId: 'threshold_step', rarity: 'UNCOMMON', isNew: true }]);
      // Owned at its copy limit → the pool rolls as usual (replays never re-grant it).
      const capped = rollReward({ content: CONTENT, heroId, owned: (id) => (id === 'threshold_step' ? 9 : 0), pity: 0, rules: DECK_RULES, poolId: 'NORMAL', seed: 1, count: 1, authored: ['threshold_step'] });
      expect(capped.options.some((o) => o.kind === 'ADD_CARD' && o.cardId === 'threshold_step')).toBe(false);
    }
  });

  it('every reward card does what it says (one real play each)', () => {
    const play = (heroId: string, cardId: string, setup: (s: GameState) => void, target: Pos | null) => {
      const e = engineFor('w3_e10', heroId);
      const s = mutable(e);
      s.units = s.units.filter((u) => u.kind === 'HERO');
      s.mechanisms = undefined;
      setup(s);
      s.player.energy = 9;
      const [uid] = setHand(e, [cardId]);
      const r = e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
      expect(r.ok, `${heroId} ${cardId}`).toBe(true);
      return { e, r };
    };
    const orcAt = (s: GameState, at: Pos, id = 'target') => {
      const base = new GameEngine(encounterFor(TEMPLE_CAMPAIGN, 'w3_e01', 'mage'), CONTENT).state.units.find((u) => u.kind === 'ENEMY')!;
      s.units.push({ ...structuredClone(base), id, pos: at, statuses: [] });
    };
    const target = (e: GameEngine) => e.state.units.find((u) => u.id === 'target')!;
    // Onda del Umbral: cross around (3,3) from (0,3): the orc on (3,3) is pushed to (4,3), 1 dmg.
    let r = play('mage', 'threshold_wave', (s) => ((heroOf(s).pos = p(0, 3)), orcAt(s, p(3, 3))), p(3, 3));
    expect(target(r.e).pos).toEqual(p(4, 3));
    // Empuje del Coloso: 3 tiles.
    r = play('warrior', 'colossus_shove', (s) => ((heroOf(s).pos = p(1, 1)), orcAt(s, p(2, 1))), p(2, 1));
    expect(target(r.e).pos).toEqual(p(5, 1));
    // Flecha Desviadora: 1 dmg + push 1.
    r = play('archer', 'deflecting_arrow', (s) => ((heroOf(s).pos = p(0, 1)), orcAt(s, p(3, 1))), p(3, 1));
    expect(target(r.e).pos).toEqual(p(4, 1));
    // Cuerda de Contrapeso: pull 2 from range 2.
    r = play('summoner', 'counterweight_rope', (s) => ((heroOf(s).pos = p(0, 1)), orcAt(s, p(2, 1))), p(2, 1));
    expect(target(r.e).pos).toEqual(p(1, 1));
    // Embestida del Umbral: charge 2–4, +1 MP.
    r = play('shapeshifter', 'threshold_pounce', (s) => ((heroOf(s).pos = p(0, 5)), orcAt(s, p(4, 5))), p(4, 5));
    expect(heroOf(r.e.state).pos).toEqual(p(3, 5));
    // Sello Roto: cleanse + 2 shield.
    r = play('warrior', 'broken_seal', (s) => (heroOf(s).statuses = [{ id: 'ROOTED', turnsLeft: 2 }]), null);
    expect(heroOf(r.e.state).statuses.some((x) => x.id === 'ROOTED')).toBe(false);
    expect(heroOf(r.e.state).shield).toBe(2);
    // Paso del Umbral: +1 MP.
    let mp = 0;
    const step = play('mage', 'threshold_step', (st) => (mp = st.player.movePoints), null);
    expect(step.e.state.player.movePoints).toBe(mp + 1);
  });
});

// ── Server: idempotent ownership ────────────────────────────────────────────────────────────
type State = {
  profile: PlayerProfile | null;
  worldRuns: Record<string, Record<string, RunState | null>> | null;
  worlds: Record<string, { worlds: WorldView[] }> | null;
};
let db: ReturnType<typeof memoryD1>;
let content: GameContent;
let txs = 0;
const temple = encounterOrder(TEMPLE_CAMPAIGN).map((e) => e.id);
const weak = (): GameContent => ({
  ...DEFAULT_CONTENT,
  enemies: Object.fromEntries(Object.entries(DEFAULT_CONTENT.enemies).map(([id, e]) => [id, WORLD_3.enemyPool.includes(id) ? { ...e, maxHp: 1, armor: 0 } : e])),
});
async function call(token: string, method: string, path: string, body?: unknown, world3 = true) {
  const req = new Request(`https://api.test/api/tactics${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handle(req, { DB: db, WARRIOR_ENABLED: '1' }, { content, now: () => 3_000_000, seed: () => 13, summonerCampaign: true, world2: true, world3, store: { catalog: [], cosmetics: {}, newId: () => `tx-${++txs}` } });
  return { status: res.status, body: (await res.json()) as State };
}
function putRun(userId: number, run: RunState) {
  db.sql.prepare(`INSERT INTO tactics_hero_campaign_runs (user_id, campaign_id, hero_id, run_json, save_version, updated_at) VALUES (?, ?, ?, ?, 1, 1) ON CONFLICT (user_id, campaign_id, hero_id) DO UPDATE SET run_json = excluded.run_json`).run(userId, run.campaignId, run.heroId, serializeRun(run));
}
function putHistory(userId: number, heroId: string, worldId: string) {
  db.sql.prepare('INSERT INTO tactics_world_progress (user_id, hero_id, world_id, completed_at, reward_granted_at) VALUES (?, ?, ?, 1, 1)').run(userId, heroId, worldId);
}
const completedRun = (campaign: typeof TEMPLE_CAMPAIGN, heroId: string): RunState => {
  const order = encounterOrder(campaign).map((e) => e.id);
  return { ...createRun(campaign, DEFAULT_CONTENT, 5, heroId), status: 'COMPLETED', currentEncounterId: order.at(-1)!, completedEncounterIds: order };
};
const atBoss = (heroId: string): RunState => ({ ...createRun(TEMPLE_CAMPAIGN, DEFAULT_CONTENT, 13, heroId), currentEncounterId: 'w3_e10', completedEncounterIds: temple.slice(0, 9) });
function bossProof(state: State, heroId: string): VictoryProof {
  const run = state.worldRuns!.temple![heroId]!;
  const encounter = currentEncounter(TEMPLE_CAMPAIGN, run);
  for (let seed = 1; seed < 80; seed++) {
    const e = new GameEngine(encounter, campaignBattleContent(content, state.profile!, run, DECK_RULES), seed);
    playBattle(e, 30);
    if (e.state.outcome?.result === 'WON') return { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(e.history)) };
  }
  throw new Error('no boss win');
}
const copies = (userId: number, heroId: string, cardId: string) =>
  (db.sql.prepare('SELECT copies, source FROM tactics_player_cards WHERE user_id = ? AND hero_id = ? AND card_id = ?').get(userId, heroId, cardId) as { copies: number; source: string } | undefined) ?? null;
const ledger = (userId: number, ref: string) => db.sql.prepare('SELECT amount_delta AS amount FROM tactics_wallet_ledger WHERE user_id = ? AND reference_id = ?').all(userId, ref);

describe('server: Act III milestones and completion are idempotent', () => {
  beforeEach(() => {
    db = memoryD1({ legacyProfiles: true });
    content = weak();
  });

  it('milestones XXII 20, XXV 30, XXIX 30 — once per champion, never for other encounters or skirmishes', async () => {
    const { id } = addAccount(db, 'miles');
    const pay = async (heroId: string, encounterId: string, skirmish = false) => {
      const plan = victoryCrystalStatements(db, id, 5_000_000, { heroId, campaignId: 'temple', encounterId, skirmish }, () => `m-${++txs}`);
      await db.batch(plan.statements);
      return (await creditedRewards(db, id, plan.rewards)).filter((r) => r.reason === 'CAMPAIGN_MILESTONE').map((r) => r.amount);
    };
    expect(await pay('mage', 'w3_e02')).toEqual([20]);
    expect(await pay('mage', 'w3_e02')).toEqual([]); // replay / retry
    expect(await pay('mage', 'w3_e05')).toEqual([30]);
    expect(await pay('mage', 'w3_e09')).toEqual([30]);
    expect(await pay('mage', 'w3_e03')).toEqual([]);
    expect(await pay('mage', 'w3_e10')).toEqual([]); // the boss pays through the completion reward
    expect(await pay('summoner', 'w3_e02')).toEqual([20]); // per champion
    expect(await pay('warrior', 'w3_e05', true)).toEqual([]);
  });

  it('hidden by default: without WORLD_3 the act can be neither started nor won', async () => {
    const { id, token } = addAccount(db, 'hidden');
    await call(token, 'POST', '/profile', {});
    putHistory(id, 'mage', 'world_2');
    const r = await call(token, 'POST', '/campaign/start', { heroId: 'mage', campaignId: 'temple' }, false);
    expect(r.status).toBe(403);
  });

  it('XXX completion: each champion gets its own card + 170 crystals + badge once; retry, reload and replay never duplicate', async () => {
    const { id, token } = addAccount(db, 'temple');
    await call(token, 'POST', '/profile', {});
    for (const heroId of ['mage', 'summoner', 'warrior'] as const) {
      const cardId = TEMPLE_COMPLETION_CARD_BY_CHAMPION[heroId]!;
      putRun(id, completedRun(ASCENT_CAMPAIGN, heroId));
      putRun(id, completedRun(INFERNAL_CAMPAIGN, heroId));
      const started = await call(token, 'POST', '/campaign/start', { heroId, campaignId: 'temple' });
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      putRun(id, atBoss(heroId));
      let state = (await call(token, 'GET', '/state')).body;
      const view = () => state.worlds![heroId]!.worlds.find((w) => w.id === 'world_3')!;
      expect(view().completionReward).toMatchObject({ crystals: 170, badgeName: 'Rompesellos del Umbral', cardId, granted: false });
      const proof = bossProof(state, heroId);
      expect((await call(token, 'POST', '/campaign/victory', { heroId, campaignId: 'temple', proof })).status).toBe(200);
      expect((await call(token, 'POST', '/campaign/victory', { heroId, campaignId: 'temple', proof })).status).toBe(200); // lost response retried
      state = (await call(token, 'GET', '/state')).body;
      expect(copies(id, heroId, cardId)).toEqual({ copies: 1, source: 'WORLD_REWARD' });
      expect(view()).toMatchObject({ completed: true, completionReward: { granted: true } });
      // Replay the boss: no second card, no second payout.
      const run = state.worldRuns!.temple![heroId]!;
      if (run.status === 'CHOOSING_REWARD') await call(token, 'POST', '/campaign/reward', { heroId, campaignId: 'temple', optionId: run.rewardOptions[0]!.id, encounterId: run.currentEncounterId });
      await call(token, 'POST', '/campaign/start', { heroId, campaignId: 'temple' });
      putRun(id, atBoss(heroId));
      const again = (await call(token, 'GET', '/state')).body;
      expect((await call(token, 'POST', '/campaign/victory', { heroId, campaignId: 'temple', proof: bossProof(again, heroId) })).status).toBe(200);
      expect(copies(id, heroId, cardId)!.copies).toBe(1);
      expect(ledger(id, `world:world_3:${heroId}`)).toEqual([{ amount: 170 }]);
    }
  }, 180_000);
});
