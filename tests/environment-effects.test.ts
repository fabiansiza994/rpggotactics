import { beforeEach, expect, it, vi } from 'vitest';
import { Container, Texture, TextureSource } from 'pixi.js';
import { EnvironmentEffects, environmentFade } from '../src/presentation/vfx/EnvironmentEffects';
import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
vi.mock('../src/presentation/pixi/paintedTextures', () => ({ loadSharedTexture: vi.fn() }));
beforeEach(() =>
  vi
    .mocked(loadSharedTexture)
    .mockResolvedValue(new Texture({ source: new TextureSource({ width: 1024, height: 1024 }) })),
);
const geometry = {
  center: () => ({ x: 0, y: 0 }),
  footprint: () => ({ w: 96, h: 48 }),
  quad: () => [],
  depth: (p: { y: number }) => p.y,
};
it('reuses four torch groups, fades removals and cleans all pooled sprites', async () => {
  const a = new Container(),
    g = new Container(),
    fx = new EnvironmentEffects(a, g, geometry);
  const points = [0, 1, 2, 3].map((i) => ({ x: i * 100, y: 30, scale: 1, depth: 30 }));
  fx.syncTorches(points);
  await fx.prepare();
  fx.tick(400);
  expect(fx.snapshot.active).toBe(16);
  const allocated = fx.snapshot.allocated;
  for (let i = 0; i < 30; i++) {
    fx.syncTorches(points);
    fx.tick(100);
  }
  expect(fx.snapshot.allocated).toBe(allocated);
  expect(a.children.every((c) => c.eventMode === 'none')).toBe(true);
  fx.syncTorches([]);
  fx.tick(451);
  expect(fx.snapshot.active).toBe(0);
  expect(a.children.length + g.children.length).toBe(0);
  fx.syncTorches(points);
  fx.tick(400);
  expect(fx.snapshot.allocated).toBe(allocated);
  fx.destroy();
  expect(a.children.length + g.children.length).toBe(0);
});
it('does not resurrect sprites when disposed during atlas loading', async () => {
  let resolve!: (t: Texture) => void;
  vi.mocked(loadSharedTexture).mockReturnValue(new Promise((r) => (resolve = r)));
  const a = new Container(),
    g = new Container(),
    fx = new EnvironmentEffects(a, g, geometry);
  fx.syncTorches([{ x: 0, y: 0, scale: 1, depth: 0 }]);
  fx.destroy();
  resolve(Texture.WHITE);
  await fx.prepare();
  fx.tick(1000);
  expect(fx.snapshot.active).toBe(0);
  expect(a.children.length).toBe(0);
});
it('fades without overshoot and reduced motion freezes particle overlays', async () => {
  expect(environmentFade(175)).toBe(0.5);
  expect(environmentFade(500, 225)).toBe(0.5);
  expect(environmentFade(1000, -1)).toBe(0);
  const a = new Container(),
    g = new Container(),
    fx = new EnvironmentEffects(a, g, geometry);
  fx.syncTorches([{ x: 0, y: 0, scale: 1, depth: 0 }]);
  await fx.prepare();
  fx.reduced = true;
  fx.tick(500);
  const visible = a.children.filter((c) => c.alpha > 0);
  expect(visible).toHaveLength(1);
  const pos = visible[0]!.position.clone();
  fx.tick(2500);
  expect(visible[0]!.position).toMatchObject({ x: pos.x, y: pos.y });
  fx.destroy();
});
