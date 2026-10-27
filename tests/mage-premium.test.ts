import { beforeEach, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Container, Texture, TextureSource } from 'pixi.js';
import { MageEffects } from '../src/presentation/vfx/MageEffects';
import { magePilot, mageRecipeEnabled } from '../src/presentation/vfx/mageRecipes';
import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
import { VfxDirector, type DirectorHost } from '../src/presentation/vfx/VfxDirector';
import { ElementEffects, type FxGeometry } from '../src/presentation/vfx/ElementEffects';
import { DEFAULT_CONTENT, GameEngine, type GameState, type ScenarioDef } from '../src/game';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { encounterCheckpoint } from '../src/presentation/qa/act3/integrationFixtures';
vi.mock('../src/presentation/pixi/paintedTextures', () => ({ loadSharedTexture: vi.fn() }));
const geometry: FxGeometry = {
  center: (p) => ({ x: p.x * 96, y: p.y * 48 }),
  footprint: () => ({ w: 96, h: 48 }),
  quad: () => [],
  depth: (p) => p.y,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { hostname: 'localhost' });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  magePilot.frost = magePilot.missile = true;
  vi.mocked(loadSharedTexture).mockResolvedValue(
    new Texture({ source: new TextureSource({ width: 1024, height: 1024 }) }),
  );
});
it('records the actual complete mage catalog without changing content', () => {
  const cards = Object.values(DEFAULT_CONTENT.cards).filter((c) => c.heroId === 'mage');
  expect(cards.some((c) => c.id === 'frost_nova')).toBe(true);
  writeFileSync(
    'qa/mage-premium-20261025/inventory.json',
    JSON.stringify(
      cards.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        targeting: c.targeting,
        presentation: c.presentation,
        effects: c.effects,
      })),
      null,
      2,
    ) + '\n',
  );
});
it('local rollout, per-recipe fallback, retry and disposed loading', async () => {
  expect(mageRecipeEnabled('fireball')).toBe(false);
  magePilot.frost = false;
  expect(mageRecipeEnabled('frost_nova')).toBe(false);
  vi.stubGlobal('location', { hostname: 'rpg-go-tactics.com' });
  const off = new MageEffects(new Container(), new Container(), geometry);
  await off.prepare();
  expect(loadSharedTexture).not.toHaveBeenCalled();
  off.destroy();
  vi.stubGlobal('location', { hostname: 'localhost' });
  magePilot.frost = true;
  const fx = new MageEffects(new Container(), new Container(), geometry);
  vi.mocked(loadSharedTexture).mockRejectedValueOnce(Error('offline'));
  await fx.prepare();
  fx.beginBatch();
  expect(fx.handles('frost_nova')).toBe(false);
  await fx.prepare();
  expect(fx.handles('frost_nova')).toBe(true);
  fx.destroy();
  let resolve!: (t: Texture) => void;
  vi.mocked(loadSharedTexture).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const gone = new MageEffects(new Container(), new Container(), geometry);
  const job = gone.prepare();
  gone.destroy();
  resolve(Texture.WHITE);
  await job;
  gone.beginBatch();
  expect(gone.ready).toBe(false);
});
it.each([false, true])(
  'bounded atlas pool, direction, cancellation, reuse, reduced=%s',
  async (reduced) => {
    const actors = new Container(),
      ground = new Container(),
      fx = new MageEffects(actors, ground, geometry);
    fx.beginBatch();
    await fx.prepare();
    fx.reduced = reduced;
    const from = { x: 1, y: 2 },
      to = { x: 3, y: 2 };
    fx.projectile(from, to, 260, { x: 100, y: 80 });
    expect(actors.children[0]!.x).toBe(100);
    fx.tick(130);
    expect(actors.children[0]!.x).toBeGreaterThan(100);
    fx.clear();
    expect(actors.children).toHaveLength(0);
    fx.impact('frost_nova', from, [to]);
    expect(ground.children.length).toBeGreaterThan(0);
    fx.tick(500);
    expect(fx.snapshot.active).toBe(0);
    for (let i = 0; i < 40; i++) fx.impact('magic_missile', to, []);
    expect(fx.snapshot.allocated).toBeLessThanOrEqual(32);
    fx.tick(500);
    const allocated = fx.snapshot.allocated;
    fx.impact('magic_missile', to, []);
    expect(fx.snapshot.allocated).toBe(allocated);
    fx.clear();
    expect(fx.snapshot.active).toBe(0);
    expect(actors.children).toHaveLength(0);
    fx.destroy();
  },
);
it('mobile variant uses smaller atlas and fewer particles without changing coordinates', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const fx = new MageEffects(new Container(), new Container(), geometry);
  await fx.prepare();
  fx.beginBatch();
  expect(vi.mocked(loadSharedTexture).mock.lastCall?.[0]).toContain('512.webp');
  fx.projectile({ x: 1, y: 2 }, { x: 2, y: 2 }, 260);
  expect(fx.snapshot.active).toBe(3);
  fx.clear();
  fx.reduced = true;
  fx.impact('magic_missile', { x: 2, y: 2 }, []);
  expect(fx.snapshot.active).toBe(1);
  fx.destroy();
});
function fixture(cardId: string, outcome: string) {
  const scenario: ScenarioDef = {
    id: 'mage-qa',
    name: 'Mage',
    description: '',
    layout: Array(5).fill('.......'),
    legend: { '.': {} },
    hero: { heroId: 'mage', pos: { x: 2, y: 2 } },
    structures: [],
    enemies: [{ id: 'target', enemyId: 'orc_warrior', pos: { x: 3, y: 2 } }],
    waves: [],
    objectives: [{ type: 'ELIMINATE_ALL' }],
    defaultSeed: 42,
  };
  const base = new GameEngine(scenario, DEFAULT_CONTENT, 42),
    state = structuredClone(base.state) as GameState;
  state.player.energy = 20;
  state.player.hand = [
    { uid: 'qa', cardId },
    { uid: 'repeat', cardId },
  ];
  const victim = state.units.find((u) => u.faction === 'ENEMY')!;
  victim.armor = 0;
  if (outcome === 'shield') victim.shield = 10;
  if (outcome === 'death') victim.hp = 1;
  const engine = GameEngine.fromSnapshot(state, DEFAULT_CONTENT, scenario),
    before = structuredClone(engine.state);
  const r = engine.dispatch({
    type: 'PLAY_CARD',
    cardUid: 'qa',
    target: cardId === 'frost_nova' ? { x: 2, y: 2 } : victim.pos,
  });
  if (!r.ok) throw Error(r.error);
  return { engine, before, events: r.events, after: engine.state };
}
for (const key of ['frost_nova', 'magic_missile'])
  for (const outcome of ['damage', 'shield', 'death'])
    for (const reduced of [false, true])
      it(`${key}/${outcome}/reduced=${reduced}: same rules, one impact, serialized replay, snapshot and cancel`, async () => {
        const f = fixture(key, outcome),
          saved = JSON.stringify(f.after),
          payload = JSON.stringify(f.events);
        const actual = new ElementEffects(
          new Container(),
          new Container(),
          (p) => geometry.center(p),
          new Container(),
        );
        await actual.mage.prepare();
        actual.mage.beginBatch();
        const impact = vi.spyOn(actual.mage, 'impact'),
          charge = vi.spyOn(actual.mage, 'charge'),
          projectile = vi.spyOn(actual.mage, 'projectile'),
          reaction = vi.spyOn(actual, 'unitReaction');
        const host: DirectorHost = {
          redraw: vi.fn(),
          unit: () => undefined,
          obstacle: () => undefined,
          walk: vi.fn(),
          busy: vi.fn(),
          impulse: vi.fn(),
          handPulse: vi.fn(),
          card: (id) => DEFAULT_CONTENT.cards[id],
          turnBanner: vi.fn(),
        };
        const d = new VfxDirector(actual, host);
        d.sync(f.before);
        const plan = compileTimeline(f.events, (id) => id, reduced),
          at = plan.cues.find((c) => c.kind === 'spellImpact')!.at;
        expect(compileTimeline(JSON.parse(payload), (id) => id, reduced)).toEqual(plan);
        expect(at).toBe(
          reduced ? (key === 'frost_nova' ? 80 : 140) : key === 'frost_nova' ? 250 : 500,
        );
        d.enqueue(f.events, f.after, reduced);
        d.tick(at - 1);
        expect(impact).not.toHaveBeenCalled();
        d.tick(1);
        expect(impact).toHaveBeenCalledOnce();
        expect(charge).toHaveBeenCalledOnce();
        expect(projectile).toHaveBeenCalledTimes(key === 'magic_missile' ? 1 : 0);
        expect(reaction).toHaveBeenCalledOnce();
        expect(reaction.mock.calls[0]![2]).toBe(
          outcome === 'shield' ? 'block' : key === 'frost_nova' ? 'ice' : 'arcane',
        );
        d.tick(2000);
        expect(d.state).toEqual(f.after);
        expect(actual.mage.snapshot.active).toBe(0);
        expect(JSON.stringify(f.after)).toBe(saved);
        expect(JSON.stringify(f.events)).toBe(payload);
        d.clear();
        d.sync(f.before);
        d.enqueue(f.events, f.after, reduced);
        d.clear();
        d.sync(f.after);
        d.tick(3000);
        expect(impact).toHaveBeenCalledOnce();
        expect(actual.mage.snapshot.active).toBe(0);
        actual.destroy();
      });
it('consecutive real casts remain ordered and do not share stale effect layers', async () => {
  const f = fixture('magic_missile', 'damage'),
    target = f.after.units.find((u) => u.faction === 'ENEMY')!;
  const r = f.engine.dispatch({ type: 'PLAY_CARD', cardUid: 'repeat', target: target.pos });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const all = [...f.events, ...r.events],
    plan = compileTimeline(all, (id) => id, false),
    impacts = plan.cues.filter((c) => c.kind === 'spellImpact');
  expect(impacts).toHaveLength(2);
  expect(impacts[1]!.at).toBeGreaterThan(impacts[0]!.at + 500);
  expect(r.events.filter((e) => e.type === 'UNIT_DAMAGED')).toHaveLength(1);
});
for (const card of ['frost_nova', 'magic_missile'])
  for (const mode of ['first_blood', 'duel'])
    it(`${mode}: ${card} real command and deterministic replay`, () => {
      const { state, scenario } = encounterCheckpoint(mode, 'mage')!;
      state.player.energy = 20;
      state.player.hand = [{ uid: 'qa', cardId: card }];
      const before = structuredClone(state),
        engine = GameEngine.fromSnapshot(state, DEFAULT_CONTENT, scenario),
        hero = state.units.find((u) => u.id === state.player.heroId)!;
      const cmd = {
        type: 'PLAY_CARD' as const,
        cardUid: 'qa',
        target:
          card === 'frost_nova' ? hero.pos : state.units.find((u) => u.faction === 'ENEMY')!.pos,
      };
      const r = engine.dispatch(cmd);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const replay = GameEngine.fromSnapshot(before, DEFAULT_CONTENT, scenario);
      expect(replay.dispatch(cmd)).toEqual(r);
      expect(replay.state).toEqual(engine.state);
      expect(r.events.some((e) => e.type === 'UNIT_DAMAGED')).toBe(true);
    });
