import { describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  createRun,
  DEFAULT_CONTENT,
  encounterAlias,
  encounterFor,
  encounterNumber,
  encounterOrder,
  GameEngine,
  guestMayFight,
  INFERNAL_CAMPAIGN,
  parseRunSave,
  primaryWorld,
  replayBattle,
  resolveEncounterId,
  serializeRun,
  totalProgress,
  validateWorlds,
  worldContext,
  worldsView,
  WORLD_1,
  WORLD_2,
  type GameContent,
  type RunState,
  type WorldHistory,
} from '../src/game';
import { removeHazard, createTerrain } from '../src/game/domain/terrain/terrain-rules';
import { playBattle } from './support/bot';
import { ctxFor, makeEngine, mutable, ofType, p, setHand, unit, LEGEND, endTurn } from './helpers';

const LAVA_LEGEND = { ...LEGEND, L: { terrain: 'LAVA' as const } };
const open = worldContext(() => true);
const hidden = worldContext(() => false);
const ascent = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);
const infernal = encounterOrder(INFERNAL_CAMPAIGN).map((e) => e.id);
const HEROES = ['mage', 'summoner', 'warrior'];

const completed = (heroId: string): RunState => ({ ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3, heroId), status: 'COMPLETED', currentEncounterId: ascent.at(-1)!, completedEncounterIds: [...ascent] });
const runsOf = (ascentRun: RunState | null, infernalRun: RunState | null = null) => ({ ascent: ascentRun, infernal: infernalRun });

describe('world model', () => {
  it('validates: ids, routes, bosses, pools, unlock chain, no unit/pickup/exit on a hazard', () => {
    expect(validateWorlds(open, DEFAULT_CONTENT)).toEqual([]);
  });

  it('World 1 is the historical campaign, unchanged: same id, same 10 encounter ids, always open', () => {
    expect(WORLD_1.campaignId).toBe('ascent');
    expect(WORLD_1.encounterIds).toEqual([
      'ascent_01_outpost', 'ascent_02_watchtower', 'ascent_03_open_field', 'ascent_04_shield_wall', 'ascent_05_alpha',
      'ascent_06_pincer', 'ascent_07_chasm', 'ascent_08_warband', 'ascent_09_elder', 'ascent_10_colossus',
    ]);
    expect(WORLD_1.unlock).toEqual({ type: 'ALWAYS' });
    expect(WORLD_1.completionReward).toBeNull();
    // A pre-worlds save still parses as it did.
    expect(parseRunSave(serializeRun(completed('summoner')), ASCENT_CAMPAIGN, DEFAULT_CONTENT).status).toBe('OK');
  });

  it('stable aliases: w1_e01 ↔ ascent_01_outpost, w2_e10; campaign-wide numbers (World 2 starts at 11)', () => {
    expect(encounterAlias(open, 'ascent_01_outpost')).toBe('w1_e01');
    expect(encounterAlias(open, 'ascent_10_colossus')).toBe('w1_e10');
    expect(encounterAlias(open, 'w2_e10')).toBe('w2_e10');
    expect(resolveEncounterId(open, 'w1_e04')).toBe('ascent_04_shield_wall');
    expect(resolveEncounterId(open, 'w2_e03')).toBe('w2_e03');
    // World 3 (Act III «El Templo del Umbral») keeps its own ids as aliases and starts at 21.
    expect(resolveEncounterId(open, 'w3_e01')).toBe('w3_e01');
    expect(encounterNumber(open, 'w3_e10')).toBe(30);
    expect(resolveEncounterId(open, 'w4_e01')).toBeNull();
    expect(encounterNumber(open, 'w2_e01')).toBe(11);
    expect(encounterNumber(open, 'w2_e10')).toBe(20);
    expect(encounterNumber(open, 'ascent_05_alpha')).toBe(5);
  });

  it('World 2 is locked before World 1 is completed, and unlocked once it is', () => {
    const fresh = worldsView(open, runsOf({ ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 1, 'mage'), completedEncounterIds: ascent.slice(0, 9), currentEncounterId: ascent[9]! }), {});
    expect(fresh.map((w) => [w.id, w.status])).toEqual([['world_1', 'IN_PROGRESS'], ['world_2', 'LOCKED'], ['world_3', 'LOCKED']]);
    expect(fresh[1]).toMatchObject({ unlocked: false, currentEncounter: null, completedEncounters: 0, totalEncounters: 10 });
    const done = worldsView(open, runsOf(completed('mage')), {});
    expect(done[0]).toMatchObject({ status: 'COMPLETED', completed: true, bossDefeated: true, completedEncounters: 10, currentEncounter: null });
    expect(done[1]).toMatchObject({ status: 'UNLOCKED', unlocked: true, completedEncounters: 0, currentEncounter: 'w2_e01', currentEncounterAlias: 'w2_e01' });
    expect(done[2]).toMatchObject({ id: 'world_3', status: 'LOCKED' });
    expect(totalProgress(done)).toEqual({ completedEncounters: 10, totalEncounters: 30, completedWorlds: 1 });
    expect(primaryWorld(done)?.id).toBe('world_2');
  });

  it('a replayed World 1 does not relock World 2 (history outlives the run)', () => {
    const history: WorldHistory = { world_1: { completedAt: 5, rewardGrantedAt: null } };
    const replay = worldsView(open, runsOf(createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 9, 'mage')), history);
    expect(replay[0]).toMatchObject({ status: 'COMPLETED', completedEncounters: 10, run: { completedEncounters: 0, status: 'IN_BATTLE' } });
    expect(replay[1]).toMatchObject({ unlocked: true, status: 'UNLOCKED' });
  });

  it('progress inside World 2 and its completion; a hidden World 2 is not listed', () => {
    const w2 = { ...createRun(INFERNAL_CAMPAIGN, DEFAULT_CONTENT, 1, 'warrior'), currentEncounterId: infernal[3]!, completedEncounterIds: infernal.slice(0, 3) };
    const views = worldsView(open, runsOf(completed('warrior'), w2), {});
    expect(views[1]).toMatchObject({ status: 'IN_PROGRESS', completedEncounters: 3, currentEncounter: 'w2_e04', rewardPending: false });
    const pendingBoss = { ...w2, status: 'CHOOSING_REWARD' as const, currentEncounterId: 'w2_e10', completedEncounterIds: [...infernal] };
    expect(worldsView(open, runsOf(completed('warrior'), pendingBoss), {})[1]).toMatchObject({ rewardPending: true, currentEncounter: null });
    expect(worldsView(hidden, runsOf(completed('warrior'), w2), {}).map((w) => w.id)).toEqual(['world_1']);
  });

  it('guests only ever fight World 1’s free encounters', () => {
    expect(infernal.map((id) => guestMayFight(INFERNAL_CAMPAIGN, id))).toEqual(infernal.map(() => false));
    expect(guestMayFight(ASCENT_CAMPAIGN, ascent[0]!)).toBe(true);
  });
});

/** Every World 2 foe with 1 HP: lets the greedy bot prove each objective can be won. */
const weak: GameContent = {
  ...DEFAULT_CONTENT,
  enemies: Object.fromEntries(Object.entries(DEFAULT_CONTENT.enemies).map(([id, e]) => [id, WORLD_2.enemyPool.includes(id) ? { ...e, maxHp: 1, armor: 0 } : e])),
};
const fragileHero = (heroId: string): GameContent => ({ ...DEFAULT_CONTENT, heroes: { ...DEFAULT_CONTENT.heroes, [heroId]: { ...DEFAULT_CONTENT.heroes[heroId]!, maxHp: 1 } } });

describe('World 2 encounters XI–XX', () => {
  it('ten encounters with varied objectives, lava on every map, a single boss at the end', () => {
    expect(infernal).toEqual(['w2_e01', 'w2_e02', 'w2_e03', 'w2_e04', 'w2_e05', 'w2_e06', 'w2_e07', 'w2_e08', 'w2_e09', 'w2_e10']);
    const encounters = encounterOrder(INFERNAL_CAMPAIGN);
    expect(encounters.map((e) => e.objectives[0]!.type)).toEqual([
      'ELIMINATE_ALL', 'REACH_TILE', 'COLLECT_OBJECTS', 'SURVIVE_ROUNDS', 'DEFEAT_TARGET',
      'REACH_TILE', 'PROTECT_TARGET', 'DEFEAT_TARGET', 'ELIMINATE_ALL', 'DEFEAT_TARGET',
    ]);
    expect(encounters.map((e) => e.tier)).toEqual(['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'ELITE', 'NORMAL', 'NORMAL', 'ELITE', 'ELITE', 'BOSS']);
    for (const e of encounters) expect(e.layout.join('')).toContain('L');
    const boss = encounters.at(-1)!;
    expect(boss.enemies.find((x) => x.id === 'king')?.enemyId).toBe('forge_king');
    expect(boss.rewards).toEqual({ pool: 'BOSS', choices: 3, favorTags: ['fire'] });
    // Only the infernal family appears in World 2.
    for (const e of encounters) for (const x of [...e.enemies, ...e.waves.flatMap((w) => w.enemies)]) expect(WORLD_2.enemyPool).toContain(x.enemyId);
  });

  for (const id of ['w2_e01', 'w2_e02', 'w2_e03', 'w2_e04', 'w2_e05', 'w2_e06', 'w2_e07', 'w2_e08', 'w2_e09', 'w2_e10'])
    it(`${id}: starts for every champion, can be won and lost, restarts and reloads cleanly`, () => {
      for (const heroId of HEROES) {
        const encounter = encounterFor(INFERNAL_CAMPAIGN, id, heroId);
        // Valid spawn: hero on its tile, nobody on lava, objective live.
        const engine = new GameEngine(encounter, DEFAULT_CONTENT, 3);
        const hero = unit(engine, heroId);
        expect(hero.pos).toEqual(encounter.hero.pos);
        for (const u of engine.state.units) expect(engine.state.board.tiles[u.pos.y * engine.state.board.width + u.pos.x]!.terrain).not.toBe('LAVA');
        expect(engine.state.objectives.every((o) => o.status === 'IN_PROGRESS')).toBe(true);
        expect(engine.state.board.tiles.some((t) => t.terrain === 'LAVA')).toBe(true);

        // Victory is reachable (objective rules + spawns are consistent).
        let won = false;
        for (let seed = 1; seed <= 6 && !won; seed++) won = playBattle(new GameEngine(encounter, weak, seed), 30, undefined, { summonAware: true, terrainAware: true }).outcome?.result === 'WON';
        expect(won, `${id} ${heroId} victory`).toBe(true);

        // Defeat is reachable: a 1-HP champion who only ends turns loses (or runs out of rounds).
        const doomed = new GameEngine(encounter, fragileHero(heroId), 5);
        for (let i = 0; i < 30 && !doomed.state.outcome; i++) doomed.dispatch(endTurn(doomed));
        expect(doomed.state.outcome?.result, `${id} ${heroId} defeat`).toBe('LOST');

        // Restart = a fresh battle with the same seed; a save of the run at this encounter reloads.
        const a = new GameEngine(encounter, DEFAULT_CONTENT, 9);
        a.dispatch(endTurn(a));
        a.restart(9);
        expect(a.state).toEqual(new GameEngine(encounter, DEFAULT_CONTENT, 9).state);
        const run = { ...createRun(INFERNAL_CAMPAIGN, DEFAULT_CONTENT, 4, heroId), currentEncounterId: id, completedEncounterIds: infernal.slice(0, infernal.indexOf(id)) };
        expect(parseRunSave(serializeRun(run), INFERNAL_CAMPAIGN, DEFAULT_CONTENT)).toEqual({ status: 'OK', run });
      }
    }, 60_000);
});

describe('LAVA', () => {
  const lavaAt = (layout: string[]) => ({ layout, legend: LAVA_LEGEND });

  it('2 FIRE damage to a unit that ENDS its side’s turn on it — once, and crossing it is free', () => {
    const engine = makeEngine({ ...lavaAt(['.L.....', '.......', '.L.....', '.......', '.......']), hero: { heroId: 'mage', pos: p(0, 2) } });
    // Walk across (0,2)→(1,2)→(2,2): no damage.
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) }).ok).toBe(true);
    expect(unit(engine, 'mage').hp).toBe(20);
    mutable(engine).player.movePoints = 3;
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) }).ok).toBe(true);
    const r = engine.dispatch(endTurn(engine));
    const lava = ofType(r.events, 'UNIT_DAMAGED').filter((e) => e.sourceId === 'terrain:LAVA');
    // Exactly one trigger in the round (player turn end), none at the enemy's turn end.
    expect(lava).toEqual([expect.objectContaining({ unitId: 'mage', damageType: 'FIRE', rawAmount: 2, hpLost: 2 })]);
  });

  it('shield absorbs it and armour reduces it, like any damage; it can kill', () => {
    // No enemies (a survival objective keeps the battle going): only the lava hurts.
    const engine = makeEngine({ ...lavaAt(['.......', '.......', 'L......', '.......', '.......']), hero: { heroId: 'mage', pos: p(0, 2) }, enemies: [], objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 9 }] });
    unit(engine, 'mage').shield = 1;
    let r = engine.dispatch(endTurn(engine));
    // Shields last until the owner's next turn start, so this one is still up at turn end.
    expect(ofType(r.events, 'UNIT_DAMAGED').find((e) => e.sourceId === 'terrain:LAVA')).toMatchObject({ shieldAbsorbed: 1, hpLost: 1 });
    unit(engine, 'mage').hp = 2;
    unit(engine, 'mage').armor = 1;
    r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'UNIT_DAMAGED').find((e) => e.sourceId === 'terrain:LAVA')).toMatchObject({ armorMitigated: 1, hpLost: 1 });
    unit(engine, 'mage').armor = 0;
    unit(engine, 'mage').hp = 2;
    r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'UNIT_DEFEATED').some((e) => e.unitId === 'mage')).toBe(true);
    expect(engine.state.outcome).toMatchObject({ result: 'LOST', reason: 'HERO_DEFEATED' });
  });

  it('hurts summons at their side’s turn end; fire creatures are immune, knights are not', () => {
    const engine = makeEngine({
      ...lavaAt(['.......', '.......', '.......', '.......', 'LL....L']),
      hero: { heroId: 'summoner', pos: p(0, 2) },
      enemies: [
        { id: 'imp', enemyId: 'infernal_imp', pos: p(6, 4) },
        { id: 'knight', enemyId: 'infernal_knight', pos: p(6, 0) },
      ],
    });
    // A summon standing on lava (placed directly: this test is about the terrain rule).
    mutable(engine).units.push({ id: 'fox-1', defId: 'fox', name: 'Zorro', faction: 'PLAYER', kind: 'SUMMON', pos: p(1, 4), hp: 11, maxHp: 11, shield: 0, armor: 0, moveRange: 0, statuses: [], targetPreference: 'HERO', summon: { ownerId: 'summoner', capacityCost: 1, lastActedRound: 99, readyRound: 99 } });
    unit(engine, 'knight').pos = p(0, 4);
    const r = engine.dispatch(endTurn(engine));
    const lava = ofType(r.events, 'UNIT_DAMAGED').filter((e) => e.sourceId === 'terrain:LAVA');
    expect(lava.find((e) => e.unitId === 'fox-1')).toMatchObject({ hpLost: 2 });
    expect(lava.find((e) => e.unitId === 'imp')).toBeUndefined();
    // The knight (armour 1) ends the enemy turn on lava only if it did not walk off; either way it is never immune.
    expect(DEFAULT_CONTENT.enemies.infernal_knight!.hazardImmune).toBeUndefined();
    expect(DEFAULT_CONTENT.enemies.infernal_imp!.hazardImmune).toBe(true);
  });

  it('is part of the map: Dispel cannot remove it and temporary terrain cannot paint over it', () => {
    const engine = makeEngine(lavaAt(['L......', '.......', '.......', '.......', '.......']));
    const ctx = ctxFor(engine);
    expect(removeHazard(ctx, p(0, 0))).toBe(false);
    expect(createTerrain(ctx, p(0, 0), 'FIRE', 2, 'test')).toBe(false);
    expect(engine.state.board.tiles[0]!.terrain).toBe('LAVA');
    // Plain FIRE is still dispellable (World 1 rules unchanged).
    expect(createTerrain(ctx, p(1, 0), 'FIRE', 2, 'test')).toBe(true);
    expect(removeHazard(ctx, p(1, 0))).toBe(true);
  });

  it('replays deterministically (same seed + commands → same state, lava events included)', () => {
    const encounter = encounterFor(INFERNAL_CAMPAIGN, 'w2_e06', 'mage');
    const engine = new GameEngine(encounter, DEFAULT_CONTENT, 77);
    playBattle(engine, 8, undefined, { terrainAware: true });
    const replay = replayBattle(encounter, DEFAULT_CONTENT, 77, [...engine.history]);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state).toEqual(engine.state);
  });
});

describe('infernal on-hit riders', () => {
  it('Caballero Infernal pushes its target one tile away (collision hurts both); onto lava it burns at turn end', () => {
    const engine = makeEngine({
      layout: ['.......', '.......', 'L......', '.......', '.......'],
      legend: LAVA_LEGEND,
      hero: { heroId: 'mage', pos: p(1, 2) },
      enemies: [{ id: 'knight', enemyId: 'infernal_knight', pos: p(4, 2) }],
    });
    unit(engine, 'knight').pos = p(2, 2);
    mutable(engine).intents = [{ kind: 'MELEE_ATTACK', enemyId: 'knight', targetUnitId: 'mage', damage: 3 }];
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'UNIT_PUSHED')).toEqual([expect.objectContaining({ unitId: 'mage', from: p(1, 2), to: p(0, 2), direction: 'LEFT' })]);
    expect(unit(engine, 'mage').pos).toEqual(p(0, 2));
    // Pushed onto lava during the enemy turn: it burns at the end of the PLAYER's next turn.
    const next = engine.dispatch(endTurn(engine));
    expect(ofType(next.events, 'UNIT_DAMAGED').some((e) => e.unitId === 'mage' && e.sourceId === 'terrain:LAVA')).toBe(true);
  });

  it('Diablillo Ígneo sets BURNING (one instance), never on a structure', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(1, 2) },
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(0, 0) }],
      enemies: [{ id: 'imp-1', enemyId: 'infernal_imp', pos: p(2, 2) }, { id: 'imp-2', enemyId: 'infernal_imp', pos: p(1, 0), targetPreference: 'OBJECTIVE' }],
    });
    setHand(engine, []);
    engine.dispatch(endTurn(engine));
    expect(unit(engine, 'mage').statuses).toEqual([{ id: 'BURNING', turnsLeft: 2 }]);
    expect(unit(engine, 'crystal').statuses).toEqual([]);
    expect(unit(engine, 'crystal').hp).toBeLessThan(10);
  });

  it('Chamán de Ceniza leaves its blast centre burning for 2 rounds (temporary FIRE that expires)', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(1, 2) }, enemies: [{ id: 'ash', enemyId: 'ash_shaman', pos: p(5, 2) }] });
    expect(engine.state.intents[0]).toMatchObject({ kind: 'AREA_SPELL', center: p(1, 2) });
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 4) });
    engine.dispatch(endTurn(engine));
    const tile = () => engine.state.board.tiles[2 * engine.state.board.width + 1]!;
    expect(tile()).toMatchObject({ terrain: 'FIRE', baseTerrain: 'NORMAL' });
    engine.dispatch(endTurn(engine));
    engine.dispatch(endTurn(engine));
    expect(tile().terrain).toBe('NORMAL');
  });

  it('El Rey de la Forja throws survivors out of its blast, away from the centre', () => {
    const engine = makeEngine({ hero: { heroId: 'warrior', pos: p(2, 2) }, enemies: [{ id: 'king', enemyId: 'forge_king', pos: p(5, 2) }] });
    mutable(engine).intents = [{ kind: 'AREA_SPELL', enemyId: 'king', center: p(3, 2), tiles: [p(2, 1), p(3, 1), p(4, 1), p(2, 2), p(3, 2), p(4, 2), p(2, 3), p(3, 3), p(4, 3)], damage: 5 }];
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'UNIT_PUSHED')).toEqual([expect.objectContaining({ unitId: 'warrior', from: p(2, 2), to: p(1, 2), direction: 'LEFT' })]);
    expect(engine.state.board.tiles[2 * engine.state.board.width + 3]!.terrain).toBe('FIRE');
  });
});
