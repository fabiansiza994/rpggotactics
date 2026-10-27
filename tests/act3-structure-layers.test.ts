import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, MeshPlane, Texture } from 'pixi.js';
import * as art from '../src/presentation/pixi/Act3Environment';
import { TempleStructures } from '../src/presentation/pixi/TempleStructures';
import { GridProjection } from '../src/presentation/pixi/GridProjection';
import { GameEngine, DEFAULT_CONTENT, encounterFor } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
const projection = new GridProjection({
  cols: 9,
  rows: 6,
  tile: 96,
  perspective: 1.18,
  depth: 0.66,
});
const objects = (id: string) =>
  new GameEngine(encounterFor(TEMPLE_CAMPAIGN, id, 'mage'), DEFAULT_CONTENT).getMechanismView()!
    .objects;
afterEach(() => vi.restoreAllMocks());
describe('temple structure rendering', () => {
  it('sorts the sliding block and lateral supports independently and preserves supports while occupied', () => {
    vi.spyOn(art, 'templeEnvironmentTexture').mockReturnValue(Texture.WHITE);
    const actors = new Container(),
      renderer = new TempleStructures(actors),
      gate = objects('w3_e01').find((o) => o.kind === 'GATE')!;
    renderer.update([gate], projection, new Map([['gate', Texture.WHITE]]), [gate.pos]);
    expect(actors.children).toHaveLength(2);
    const unitDepth = projection.depthAtPoint(projection.getUnitAnchor(gate.pos));
    expect(actors.children[0]!.zIndex).toBeLessThan(unitDepth);
    expect(actors.children[1]!.zIndex).toBeGreaterThan(unitDepth);
    expect(actors.children[0]!.alpha).toBe(1);
    expect(actors.children[1]!.alpha).toBe(0.65);
    renderer.update([gate], projection, new Map([['gate', Texture.WHITE]]), []);
    expect(actors.children[1]!.alpha).toBe(1);
    renderer.update([], projection, new Map());
    expect(actors.children).toHaveLength(0);
    renderer.destroy();
  });
  it('uses one bridge mesh and resolves lower/raise without duplicating atlas cells', () => {
    const actors = new Container(),
      renderer = new TempleStructures(actors),
      bridge = objects('w3_e02').filter((o) => o.kind === 'BRIDGE');
    renderer.update(bridge, projection, new Map([['bridge', Texture.WHITE]]));
    expect(actors.children).toHaveLength(1);
    const panel = (actors.children[0] as Container).children.find((c) => c instanceof MeshPlane)!;
    expect(panel.visible).toBe(true);
    const raisedX = (panel as MeshPlane).geometry.getAttribute('aPosition').buffer.data[2]!;
    renderer.update(
      bridge.map((o) => ({ ...o, state: 'LOWERED' })),
      projection,
      new Map([['bridge', Texture.WHITE]]),
    );
    renderer.tick(250, false);
    expect(panel.alpha).toBe(1);
    expect((panel as MeshPlane).geometry.getAttribute('aPosition').buffer.data[2]!).toBeGreaterThan(
      raisedX,
    );
    renderer.tick(250, false);
    expect(panel.alpha).toBe(1);
    renderer.update(bridge, projection, new Map([['bridge', Texture.WHITE]]));
    renderer.tick(0, true);
    expect(panel.visible).toBe(true);
    renderer.destroy();
    expect(actors.children).toHaveLength(0);
  });
});
