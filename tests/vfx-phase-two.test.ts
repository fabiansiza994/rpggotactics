import { beforeEach, expect, it, vi } from 'vitest';
import { Container, Texture, TextureSource } from 'pixi.js';
import { BastionEffects } from '../src/presentation/vfx/BastionEffects';
import { PactSummonEffects } from '../src/presentation/vfx/PactSummonEffects';
import { phaseTwoPilot } from '../src/presentation/vfx/phaseTwoRecipes';
import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
import { VfxDirector, type DirectorHost } from '../src/presentation/vfx/VfxDirector';
import type { ElementEffects, FxGeometry } from '../src/presentation/vfx/ElementEffects';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { DEFAULT_CONTENT, GameEngine, type GameState, type ScenarioDef } from '../src/game';
vi.mock('../src/presentation/pixi/paintedTextures', () => ({ loadSharedTexture: vi.fn() }));
const geometry: FxGeometry = {
  center: (p) => ({ x: p.x * 96, y: p.y * 48 }),
  footprint: () => ({ w: 96, h: 48 }),
  quad: () => [],
  depth: (p) => p.y,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { hostname: '127.0.0.1' });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  phaseTwoPilot.bastion = phaseTwoPilot.golem = true;
  vi.mocked(loadSharedTexture).mockResolvedValue(
    new Texture({ source: new TextureSource({ width: 1024, height: 1024 }) }),
  );
});
for (const Effect of [BastionEffects, PactSummonEffects]) {
  it(`${Effect.name}: bounded pools, cancellation, reuse, mobile and reduced motion`, async () => {
    const fx = new Effect(new Container(), new Container(), geometry);
    fx.beginBatch();
    await fx.prepare();
    const play = () =>
      fx instanceof BastionEffects
        ? fx.impact({ x: 1, y: 2 }, { x: 2, y: 2 })
        : fx.arrive({ x: 2, y: 2 });
    for (let i = 0; i < 30; i++) play();
    expect(fx.snapshot.allocated).toBe(32);
    fx.tick(1000);
    expect(fx.snapshot.active).toBe(0);
    play();
    expect(fx.snapshot.allocated).toBe(32);
    fx.clear();
    expect(fx.snapshot.active).toBe(0);
    fx.reduced = true;
    play();
    expect(fx.snapshot.active).toBe(2);
    fx.tick(200);
    expect(fx.snapshot.active).toBe(0);
    fx.destroy();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const mobile = new Effect(new Container(), new Container(), geometry);
    await mobile.prepare();
    expect(vi.mocked(loadSharedTexture).mock.lastCall?.[0]).toContain('512.webp');
    mobile.destroy();
  });
  it(`${Effect.name}: public host off and disposed load cannot resurrect sprites`, async () => {
    vi.stubGlobal('location', { hostname: 'rpg-go-tactics.com' });
    const off = new Effect(new Container(), new Container(), geometry);
    await off.prepare();
    expect(loadSharedTexture).not.toHaveBeenCalled();
    off.destroy();
    vi.stubGlobal('location', { hostname: 'localhost' });
    let resolve!: (t: Texture) => void;
    vi.mocked(loadSharedTexture).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const fx = new Effect(new Container(), new Container(), geometry);
    const p = fx.prepare();
    fx.destroy();
    resolve(Texture.WHITE);
    await p;
    fx.beginBatch();
    expect(fx.ready).toBe(false);
  });
}
function fixture(cardId: string) {
  const scenario: ScenarioDef = {
    id: 'phase-two',
    name: 'QA',
    description: '',
    layout: Array(5).fill('.......'),
    legend: { '.': {} },
    hero: { heroId: cardId === 'bastion_blow' ? 'warrior' : 'summoner', pos: { x: 2, y: 2 } },
    structures: [],
    enemies: [{ id: 'target', enemyId: 'orc_warrior', pos: { x: 3, y: 2 } }],
    waves: [],
    objectives: [{ type: 'ELIMINATE_ALL' }],
    defaultSeed: 42,
  };
  const base = new GameEngine(scenario, DEFAULT_CONTENT, 42),
    s = structuredClone(base.state) as GameState;
  s.player.energy = 20;
  s.player.hand = [{ uid: 'qa', cardId }];
  s.units.find((u) => u.kind === 'HERO')!.shield = 4;
  const engine = GameEngine.fromSnapshot(s, DEFAULT_CONTENT, scenario),
    before = structuredClone(engine.state),
    r = engine.dispatch({
      type: 'PLAY_CARD',
      cardUid: 'qa',
      target: cardId === 'bastion_blow' ? { x: 3, y: 2 } : { x: 2, y: 3 },
    });
  if (!r.ok) throw Error(r.error);
  const bastion = { ready: true, beginBatch: vi.fn(), anticipate: vi.fn(), impact: vi.fn() },
    pactSummon = { ready: true, beginBatch: vi.fn(), prepareCircle: vi.fn(), arrive: vi.fn() };
  const effects = new Proxy(
    { bastion, pactSummon },
    {
      get: (o, k) =>
        k in o
          ? o[k as keyof typeof o]
          : k === 'lift' || k === 'center'
            ? (p: unknown) => p
            : vi.fn(),
      set: () => true,
    },
  ) as unknown as ElementEffects;
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
  const director = new VfxDirector(effects, host);
  director.sync(before);
  return { director, bastion, pactSummon, events: r.events, after: engine.state };
}
for (const card of ['bastion_blow', 'summon_pact_golem'])
  for (const reduced of [false, true]) {
    it(`${card}: unique confirmed contact/spawn, replay and reconnect (reduced=${reduced})`, () => {
      const f = fixture(card),
        serialized = JSON.stringify(f.events),
        plan = compileTimeline(
          f.events,
          (id) => DEFAULT_CONTENT.cards[id]?.presentation.visualKey ?? id,
          reduced,
        );
      expect(
        compileTimeline(
          JSON.parse(serialized),
          (id) => DEFAULT_CONTENT.cards[id]?.presentation.visualKey ?? id,
          reduced,
        ),
      ).toEqual(plan);
      f.director.enqueue(f.events, f.after, reduced);
      const arrival = card === 'summon_pact_golem',
        cue = plan.cues.find((c) =>
          arrival ? c.event.type === 'UNIT_SPAWNED' : c.kind === 'spellImpact',
        )!;
      const spy = arrival ? f.pactSummon.arrive : f.bastion.impact;
      expect(spy).not.toHaveBeenCalled();
      f.director.tick(cue.at - 1);
      expect(spy).not.toHaveBeenCalled();
      f.director.tick(1);
      expect(spy).toHaveBeenCalledOnce();
      f.director.tick(5000);
      expect(spy).toHaveBeenCalledOnce();
      expect(f.director.state).toEqual(f.after);
      expect(JSON.stringify(f.events)).toBe(serialized);
      const g = fixture(card);
      g.director.enqueue(g.events, g.after, reduced);
      g.director.clear();
      g.director.sync(g.after);
      g.director.tick(5000);
      expect(arrival ? g.pactSummon.arrive : g.bastion.impact).not.toHaveBeenCalled();
    });
  }
it('summon decoration is not played without authoritative UNIT_SPAWNED', () => {
  const f = fixture('summon_pact_golem');
  f.director.enqueue(
    f.events.filter((e) => e.type !== 'UNIT_SPAWNED'),
    f.after,
    false,
  );
  f.director.tick(5000);
  expect(f.pactSummon.arrive).not.toHaveBeenCalled();
});
