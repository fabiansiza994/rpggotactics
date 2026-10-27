import { describe, it, expect, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { TempleStructures } from '../src/presentation/pixi/TempleStructures';
import {
  SlidingAccess,
  accessSlide,
  ACCESS_SLIDE_MS,
} from '../src/presentation/pixi/SlidingAccess';
import { flamePose } from '../src/presentation/pixi/TorchFlame';
import { GridProjection } from '../src/presentation/pixi/GridProjection';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { presentPublicCast, usePublicCast } from '../src/presentation/cards/publicCast';
import { GameEngine, DEFAULT_CONTENT, encounterFor, type GameEvent } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
const projection = new GridProjection({
  cols: 9,
  rows: 6,
  tile: 96,
  perspective: 1.18,
  depth: 0.66,
  oblique: 0.58,
});
describe('heavy sliding access and card presentation', () => {
  it('keeps two supports and translates a single stone block with stable supports and perspective-correct dimensions', () => {
    const back = new Container(),
      front = new Container(),
      access = new SlidingAccess(back, front),
      pos = { x: 5, y: 2 };
    access.draw(pos, 0, projection);
    const closed = access.block.getBounds(),
      supports = access.supports.getBounds();
    access.draw(pos, 1, projection);
    const open = access.block.getBounds();
    expect(open.y).toBeLessThan(closed.y);
    expect(open.width / closed.width).toBeGreaterThan(0.9);
    expect(open.width / closed.width).toBeLessThan(1.1);
    expect(access.supports.getBounds()).toEqual(supports);
    expect(accessSlide(0)).toBe(0);
    expect(accessSlide(1)).toBe(1);
    expect(ACCESS_SLIDE_MS).toBe(900);
  });
  it('holds presentation busy until settled and restores an open saved state without replaying movement', () => {
    const e = new GameEngine(encounterFor(TEMPLE_CAMPAIGN, 'w3_e01', 'mage'), DEFAULT_CONTENT);
    const gate = e.getMechanismView()!.objects.find((o) => o.kind === 'GATE')!;
    const state = JSON.stringify(e.state),
      settled = vi.fn(),
      actors = new Container(),
      render = new TempleStructures(actors, settled);
    const textures = new Map([['gate', Texture.WHITE]]);
    render.update([gate], projection, textures);
    expect(render.busy).toBe(false);
    render.update([{ ...gate, state: 'OPEN' }], projection, textures);
    expect(render.busy).toBe(true);
    render.tick(450, false);
    expect(render.busy).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    render.tick(450, false);
    expect(render.busy).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);
    render.destroy();
    const restored = new TempleStructures(actors);
    restored.update([{ ...gate, state: 'OPEN' }], projection, textures);
    expect(restored.busy).toBe(false);
    expect(JSON.stringify(e.state)).toBe(state);
    restored.destroy();
  });
  it('uses shared readable budgets and emits resolve after the display hold', () => {
    const events: GameEvent[] = [
      {
        type: 'CARD_PLAYED',
        cardUid: 'qa',
        cardId: 'force_push',
        casterId: 'mage',
        target: null,
        impact: { x: 2, y: 2 },
        affectedTiles: [{ x: 2, y: 2 }],
        direction: null,
      },
      { type: 'CARD_RESOLVED', cardUid: 'qa', cardId: 'force_push' },
    ];
    const normal = compileTimeline(events, (id) => id, false),
      readable = compileTimeline(events, (id) => id, false, true);
    expect(normal.cues.find((c) => c.kind === 'cast')!.duration).toBe(220);
    expect(readable.cues.find((c) => c.kind === 'cast')!.duration).toBe(220);
    expect(readable).toEqual(normal);
    expect(readable.cues.find((c) => c.event.type === 'CARD_RESOLVED')!.at).toBeGreaterThanOrEqual(
      800,
    );
    expect(compileTimeline(events, (id) => id, true, true).duration).toBeLessThan(
      readable.duration,
    );
  });
  it('uses only the publicly cast card identity and clears it without hand access', () => {
    presentPublicCast({ cardId: 'fireball', cardUid: 'public-operation', casterId: 'rival' });
    expect(usePublicCast.getState().cast).toEqual({
      cardId: 'fireball',
      cardUid: 'public-operation',
      casterId: 'rival',
    });
    presentPublicCast(null);
    expect(usePublicCast.getState().cast).toBeNull();
  });
  it('animates a bounded deterministic flame and uses a static reduced-motion pose', () => {
    expect(flamePose(10, 0, false)).not.toEqual(flamePose(400, 0, false));
    expect(flamePose(10, 0, true)).toEqual(flamePose(400, 1, true));
    for (let ms = 0; ms < 2000; ms += 100) {
      const p = flamePose(ms, 0, false);
      expect(p.y).toBeGreaterThan(0.85);
      expect(p.y).toBeLessThan(1.15);
    }
  });
});
