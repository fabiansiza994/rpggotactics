import { describe, expect, it } from 'vitest';
import { explainCardBlock, occupantList } from '../src/presentation/react/cardBlock';
import { describeEvent, ERROR_LABEL } from '../src/presentation/react/format';
import { dealDamage } from '../src/game/domain/combat/damage';
import { ctxFor, makeEngine, mutable, p, setHand } from './helpers';
import { DEFAULT_CONTENT, GameEngine } from '../src/game';

/** First-playtest pass E2: every blocked hand card says why, from the engine's own verdict. */
const engineFor = (heroId: string, enemies = [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 2) }]) =>
  makeEngine({ hero: { heroId, pos: p(0, 2) }, enemies });
const block = (e: ReturnType<typeof engineFor>, uid: string) => explainCardBlock(e, e.state, uid);

describe('explainCardBlock', () => {
  it('is null for a card that can be played now', () => {
    const e = engineFor('summoner');
    const [fox] = setHand(e, ['summon_fox']);
    expect(block(e, fox!)).toBeNull();
  });

  it('energy: says what the card needs and what you have', () => {
    const e = engineFor('summoner');
    const [fox] = setHand(e, ['summon_fox']);
    mutable(e).player.energy = 1;
    expect(block(e, fox!)).toMatchObject({
      code: 'NOT_ENOUGH_ENERGY',
      sub: 'necesita 2 · tienes 1',
      detail: expect.stringContaining('necesitas 2 y tienes 1'),
    });
  });

  it('capacity: names the occupants, points needed and points free; clears when the summon dies', () => {
    const e = engineFor('summoner');
    const [wolf] = setHand(e, ['summon_wolf']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: wolf!, target: p(1, 2) }).ok).toBe(true);
    mutable(e).player.energy = 4;
    const [fox] = setHand(e, ['summon_fox']);
    const b = block(e, fox!);
    expect(b).toMatchObject({ code: 'SUMMON_CAPACITY', sub: 'necesita 1 · libre 0' });
    expect(b!.detail).toContain('necesita 1 punto');
    expect(b!.detail).toContain('0 puntos libres de 2');
    expect(b!.detail).toContain('Ocupan: Lobo (2)');
    expect(b!.detail).not.toContain('energía y tienes');
    dealDamage(ctxFor(e), mutable(e).units.find((u) => u.kind === 'SUMMON')!, 99, 't', 'PHYSICAL');
    expect(block(e, fox!)).toBeNull();
  });

  it('capacity first (engine order), with the energy shortfall added to the same explanation', () => {
    const e = engineFor('summoner');
    const [wolf] = setHand(e, ['summon_wolf']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: wolf!, target: p(1, 2) }).ok).toBe(true);
    mutable(e).player.energy = 1;
    const [fox] = setHand(e, ['summon_fox']);
    const b = block(e, fox!)!;
    expect(b.code).toBe('SUMMON_CAPACITY');
    expect(b.detail).toContain('Además necesitas 2 de energía y tienes 1');
  });

  it('a Wolf needs 2 points: one Fox on the board leaves 1 free, still not enough', () => {
    const e = engineFor('summoner');
    const [fox] = setHand(e, ['summon_fox']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: fox!, target: p(1, 2) }).ok).toBe(true);
    mutable(e).player.energy = 4;
    const [wolf] = setHand(e, ['summon_wolf']);
    expect(block(e, wolf!)).toMatchObject({ code: 'SUMMON_CAPACITY', sub: 'necesita 2 · libre 1' });
  });

  it('B3: playable by the rules but with no legal target is reported, not silently selectable', () => {
    const e = engineFor('summoner');
    const [recall] = setHand(e, ['recall_familiar']);
    expect(e.getCardPlayability(recall!)).toEqual({ playable: true });
    expect(e.getValidTargets(recall!)).toEqual([]);
    expect(block(e, recall!)).toMatchObject({
      code: 'NO_VALID_TARGET',
      detail: expect.stringContaining('ninguna invocación tuya'),
    });
    const w = engineFor('warrior');
    const [strike] = setHand(w, ['heavy_strike']);
    expect(block(w, strike!)).toMatchObject({ code: 'NO_VALID_TARGET', detail: expect.stringContaining('ningún enemigo') });
  });

  it('B3: a ritual piece without a target stays usable (it can be sealed on the altar)', () => {
    const e = engineFor('summoner');
    const [piece] = setHand(e, ['rune_stone']);
    expect(e.getValidTargets(piece!)).toEqual([]);
    expect(e.getCommitPlayability(piece!).playable).toBe(true);
    expect(block(e, piece!)).toBeNull();
  });

  it.each([
    ['summoner', 'Invocador'],
    ['warrior', 'Guerrero'],
    ['mage', 'Mago'],
  ])('CASTER_INCAPACITATED names the real champion (%s)', (heroId, name) => {
    const e = engineFor(heroId);
    const hero = mutable(e).units.find((u) => u.id === e.heroId)!;
    hero.statuses.push({ id: 'STUNNED', turnsLeft: 1 });
    const uid = e.state.player.hand[0]!.uid;
    const b = block(e, uid)!;
    expect(b.code).toBe('CASTER_INCAPACITATED');
    expect(b.detail.startsWith(`${name} no puede actuar`)).toBe(true);
  });

  it('the shared label is champion-neutral and every RuleError keeps a label (PvP map)', () => {
    expect(ERROR_LABEL.CASTER_INCAPACITATED).not.toContain('Mago');
    expect(ERROR_LABEL.SUMMON_CAPACITY).toBe('Capacidad de invocación completa');
  });

  it('occupantList reads naturally', () => {
    expect(occupantList([{ name: 'Lobo', cost: 2 }])).toBe('Lobo (2)');
    expect(occupantList([{ name: 'Pollo', cost: 1 }, { name: 'Zorro', cost: 1 }])).toBe('Pollo (1) y Zorro (1)');
  });
});

describe('combat log: UNIT_SPAWNED tone', () => {
  it('own summons are good news, enemy reinforcements stay a warning', () => {
    const e = engineFor('summoner');
    const [fox] = setHand(e, ['summon_fox']);
    const result = e.dispatch({ type: 'PLAY_CARD', cardUid: fox!, target: p(1, 2) });
    const spawn = result.events.find((ev) => ev.type === 'UNIT_SPAWNED')!;
    expect(describeEvent(spawn, e.state)).toMatchObject({ tone: 'good', text: expect.stringContaining('Invocas') });
    const enemySpawn = { type: 'UNIT_SPAWNED', unitId: 'orc-1', faction: 'ENEMY', kind: 'ENEMY', pos: p(6, 2) } as const;
    expect(describeEvent(enemySpawn, e.state)).toMatchObject({ tone: 'bad', text: expect.stringContaining('Aparece') });
  });
});

describe('explainCardBlock: whole-hand states', () => {
  it('outside the player turn every card is blocked quietly (no chip flood)', () => {
    const e = engineFor('summoner');
    const s = structuredClone(e.state);
    (s as { phase: string }).phase = 'ENEMY';
    // Same path as a PvP seat view during the rival's turn.
    const view = GameEngine.fromSnapshot(s, DEFAULT_CONTENT, e.scenario);
    const b = explainCardBlock(view, view.state, s.player.hand[0]!.uid);
    expect(b).toMatchObject({ code: 'NOT_PLAYER_TURN', quiet: true });
  });
});
