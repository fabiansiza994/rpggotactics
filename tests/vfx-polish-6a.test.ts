import { beforeEach, expect, it, vi } from 'vitest';
import { Container, Texture, TextureSource } from 'pixi.js';
import { MageEffects } from '../src/presentation/vfx/MageEffects';
import { magePilot } from '../src/presentation/vfx/mageRecipes';
import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
import type { FxGeometry } from '../src/presentation/vfx/ElementEffects';
vi.mock('../src/presentation/pixi/paintedTextures', () => ({ loadSharedTexture: vi.fn() }));
const geometry: FxGeometry = {
  center: (p) => ({ x: p.x * 96, y: p.y * 48 }),
  footprint: () => ({ w: 96, h: 48 }),
  quad: () => [],
  depth: (p) => p.y,
};
beforeEach(() => {
  vi.stubGlobal('location', { hostname: 'localhost' });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  magePilot.frost = magePilot.missile = true;
  vi.mocked(loadSharedTexture).mockResolvedValue(
    new Texture({ source: new TextureSource({ width: 1024, height: 1024 }) }),
  );
});
it.each([false, true])(
  'arcane charge/contact is in front of the body, using ground depth not lifted Y (reduced=%s)',
  async (reduced) => {
    const actors = new Container(),
      fx = new MageEffects(actors, new Container(), geometry);
    await fx.prepare();
    fx.beginBatch();
    fx.reduced = reduced;
    const p = { x: 2, y: 2 },
      depth = geometry.depth(geometry.center(p));
    fx.charge('magic_missile', p, 240, { x: 195, y: 30 });
    expect(actors.children[0]!.zIndex).toBeGreaterThan(depth);
    fx.clear();
    fx.impact('magic_missile', p, []);
    expect(actors.children.length).toBeGreaterThan(0);
    for (const s of actors.children) expect(s.zIndex).toBeGreaterThan(depth);
    fx.tick(60);
    expect(fx.snapshot.active).toBeGreaterThan(0);
    fx.tick(1000);
    expect(fx.snapshot.active).toBe(0);
    fx.destroy();
  },
);
it('mobile nova distributes its four shards around the caster rather than dropping the lower half', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const ground = new Container(),
    fx = new MageEffects(new Container(), ground, geometry);
  await fx.prepare();
  fx.beginBatch();
  const caster = { x: 2, y: 2 },
    tiles = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ],
    original = JSON.stringify(tiles);
  fx.impact('frost_nova', caster, tiles);
  const shards = ground.children.slice(1, 5),
    c = geometry.center(caster);
  expect(shards).toHaveLength(4);
  expect(shards.some((s) => s.y < c.y)).toBe(true);
  expect(shards.some((s) => s.y > c.y)).toBe(true);
  expect(shards.some((s) => s.x < c.x)).toBe(true);
  expect(shards.some((s) => s.x > c.x)).toBe(true);
  expect(JSON.stringify(tiles)).toBe(original);
  fx.destroy();
});
