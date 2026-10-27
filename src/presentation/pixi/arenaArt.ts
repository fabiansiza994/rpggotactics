import { Container, Graphics, Matrix, Sprite } from 'pixi.js';
import { drawTempleBlock } from './RotatingSections';
import { drawInfernalIronwork } from './infernalProps';
import { isVeilEncounter, veilStage } from '../assets/archerHuntVisuals';
import { veilProp } from './veilProps';
import type { GameState } from '../../game';
import { battlefieldStyle, encounterIdentity } from '../assets/visualIdentity.ts';
import { paintedCharacter } from './paintedTextures.ts';
import type { GridProjection, Point } from './GridProjection';
import { SHADOW_OFFSET, TILE, obstacleSpec, spriteScale } from './renderContract.ts';

// Coordinate-hashed decoration: stable across turns, independent of the game's RNG.
const noise = (seed: number) => ((Math.imul(seed + 17, 1597334677) >>> 0) % 997) / 997;

/**
 * Flat tile surface in logical tile space (size × size per cell, origin at the board's top-left).
 * It is rendered once into a texture and mapped onto the projected board by a PerspectiveMesh, so
 * the painted materials of Checkpoint 05 are kept and simply follow the perspective.
 */
export function drawSurface(state: Readonly<GameState>, size: number): Graphics {
  const g = new Graphics();
  const { board } = state;
  const style = battlefieldStyle(state.scenarioId);
  const infernal = state.scenarioId.startsWith('w2_');
  const material = paintedCharacter(infernal ? 'infernal_basalt' : 'stone');
  if (!board.tiles.some((t) => t.terrain === 'VOID'))
    g.rect(0, 0, board.width * size, board.height * size).fill(0x0d151d);
  board.tiles.forEach((tile, i) => {
    const x = (i % board.width) * size,
      y = Math.floor(i / board.width) * size;
    const s = size;
    const n = noise(i * 7);
    const stone = (isVeilEncounter(state.scenarioId) ? [0x34463d, 0x394c43, 0x303f3b, 0x3c4941] : [0x34434e, 0x394853, 0x303f4b, 0x3c4951])[Math.floor(n * 4)]!;
    if (tile.terrain === 'VOID') return;
    if (tile.terrain === 'BLOCKED') {
      // BLOCKED is the abyss in the actual scenario legend; pillars are obstacles.
      g.rect(x + 1, y + 1, s - 2, s - 2).fill(0x030811);
      g.poly([
        x + 3,
        y + 3,
        x + s - 3,
        y + 3,
        x + s - 11,
        y + 15,
        x + 13,
        y + 11,
        x + 12,
        y + s - 10,
        x + 3,
        y + s - 3,
      ]).fill(0x233541);
      g.poly([
        x + s - 3,
        y + 3,
        x + s - 3,
        y + s - 3,
        x + 3,
        y + s - 3,
        x + 15,
        y + s - 13,
        x + s - 14,
        y + s - 17,
      ]).fill(0x0e1825);
      g.ellipse(x + s * 0.53, y + s * 0.67, s * 0.22, s * 0.08).fill({
        color: 0x325475,
        alpha: 0.2,
      });
      continueTileRim(g, x, y, s);
      return;
    }
    g.poly([
      x + 3,
      y + 4,
      x + s - 5,
      y + 3,
      x + s - 2,
      y + s - 6,
      x + s - 8,
      y + s - 2,
      x + 2,
      y + s - 3,
    ]).fill(
      material
        ? {
            texture: material,
            textureSpace: 'global',
            matrix: new Matrix().scale(
              (s * 2.7) / material!.width,
              (s * 2.7) / material!.height,
            ),
            color: infernal ? 0xc5bbc0 : isVeilEncounter(state.scenarioId) ? 0xa8bbaa : [0xb8cbd8, 0xc3ced7, 0xd2d2c7, 0xadc4d4][Math.floor(n * 4)],
          }
        : stone,
    );
    // Low-contrast wear belongs to ordinary stone, never masquerading as a hazard.
    if (tile.terrain === 'NORMAL' && n > 0.48) {
      const shade = style === 'ceremonial' ? 0x819ba7 : style === 'courtyard' ? 0x49382b : 0x182a32;
      g.poly([x + 8, y + 12, x + 36, y + 8, x + 55, y + 30, x + 33, y + 54, x + 10, y + 48]).fill({
        color: shade,
        alpha: style === 'courtyard' ? 0.14 : 0.11,
      });
      if (style === 'weathered' || style === 'fractured')
        g.moveTo(x + 12, y + 16)
          .lineTo(x + 39, y + 32)
          .lineTo(x + 32, y + 56)
          .lineTo(x + 62, y + 75)
          .stroke({ color: 0x142029, width: 2, alpha: 0.65 });
      if (style === 'ceremonial' && i % 3 === 0)
        g.moveTo(x + 12, y + 12)
          .lineTo(x + 12, y + 35)
          .moveTo(x + 12, y + 12)
          .lineTo(x + 35, y + 12)
          .stroke({ color: 0xa1aaa0, width: 2, alpha: 0.22 });
    }
    // Broad mineral facets and chipped corners vary by coordinate, independent of Core RNG.
    if (n > 0.35)
      g.poly([
        x + 9,
        y + 9,
        x + s - 12,
        y + 7,
        x + s * (0.48 + n * 0.2),
        y + s * 0.45,
        x + 8,
        y + s * 0.7,
      ]).fill({ color: 0xa5b3b5, alpha: 0.025 + n * 0.035 });
    if (n > 0.72)
      g.poly([x + s - 18, y + s - 6, x + s - 7, y + s - 21, x + s - 5, y + s - 5]).fill(0x17232e);
    if (n < 0.22)
      g.moveTo(x + 17, y + 24)
        .lineTo(x + 35, y + 19)
        .lineTo(x + 57, y + 31)
        .lineTo(x + 72, y + 26)
        .stroke({ color: 0xa6b9bc, width: 1, alpha: 0.12 });
    g.moveTo(x + 5, y + s - 4)
      .lineTo(x + s - 5, y + s - 4)
      .lineTo(x + s - 4, y + 7)
      .stroke({ color: 0x0e1a25, width: 1.5, alpha: 0.85 });
    g.moveTo(x + 4, y + s - 8)
      .lineTo(x + 4, y + 5)
      .lineTo(x + s - 8, y + 5)
      .stroke({ color: 0xb6d4e2, alpha: 0.23, width: 1 });
    // Small mineral chips and asymmetrical cracks, never a checkerboard texture.
    for (let j = 0; j < 6; j++) {
      const px = x + 9 + noise(i * 31 + j * 5) * (s - 20);
      const py = y + 10 + noise(i * 19 + j * 11) * (s - 22);
      g.poly([px, py, px + 3 + (j % 4), py - 1, px + 2, py + 2]).fill({
        color: j % 2 ? 0x92a0a4 : 0x172730,
        alpha: 0.11,
      });
    }
    const cx = x + s * (0.27 + n * 0.4),
      cy = y + s * 0.46;
    g.moveTo(x + 4, y + 15 + n * 25)
      .lineTo(cx, cy)
      .lineTo(cx + 6, cy + 14)
      .lineTo(cx - 1, cy + 23)
      .stroke({ color: 0x15252f, width: 1.3, alpha: 0.8 });
    // Sparse mineral wear: wet stone, dust, and a nearly erased mason's rune.
    if (n > 0.78)
      g.ellipse(x + s * 0.62, y + s * 0.65, s * 0.26, s * 0.13).fill({
        color: 0x121f29,
        alpha: 0.18,
      });
    if (n < 0.14) {
      g.moveTo(x + s * 0.39, y + s * 0.43)
        .lineTo(x + s * 0.51, y + s * 0.31)
        .lineTo(x + s * 0.62, y + s * 0.43)
        .lineTo(x + s * 0.51, y + s * 0.61)
        .stroke({ color: 0x9aaea9, alpha: 0.13, width: 1 });
    }
    if (tile.terrain === 'COVER' && !isVeilEncounter(state.scenarioId)) {
      g.roundRect(x + s * 0.12, y + s * 0.73, s * 0.76, s * 0.13, 3)
        .fill(0x9a8d6d)
        .stroke({ color: 0xe1c98a, width: 2 });
      g.moveTo(x + s * 0.45, y + s * 0.73)
        .lineTo(x + s * 0.45, y + s * 0.86)
        .stroke({ color: 0x293740, width: 3 });
    } else if (tile.terrain === 'HAZARD') {
      g.rect(x + 4, y + 4, s - 8, s - 8).fill({ color: 0xd04f27, alpha: 0.26 });
      g.poly([
        x + s * 0.5,
        y + s * 0.23,
        x + s * 0.75,
        y + s * 0.7,
        x + s * 0.25,
        y + s * 0.7,
      ]).stroke({ color: 0xffb05e, width: 3 });
    } else if (tile.terrain === 'ARCANE') {
      g.circle(x + s * 0.5, y + s * 0.5, s * 0.29)
        .fill({ color: 0x855df2, alpha: 0.18 })
        .stroke({ color: 0xbda0ff, width: 2 });
      g.poly([
        x + s * 0.5,
        y + s * 0.24,
        x + s * 0.72,
        y + s * 0.5,
        x + s * 0.5,
        y + s * 0.76,
        x + s * 0.28,
        y + s * 0.5,
      ]).stroke({ color: 0xd5bdff, width: 3 });
    }
    if (tile.terrain === 'LAVA') {
      // Permanent magma has a jagged crust and warning sigil; temporary fire uses sparks.
      g.rect(x + 3, y + 3, s - 6, s - 6).fill(0x6e200c).stroke({ color: 0xf4a358, width: 2.5 });
      const lava = paintedCharacter('infernal_lava');
      if (lava) g.rect(x + 6, y + 6, s - 12, s - 12).fill({ texture: lava, textureSpace: 'global', matrix: new Matrix().scale(s / lava.width, s / lava.height) });
      for (let k = 0; k < 4; k++) {
        const px = x + 9 + k * s * 0.21;
        g.poly([px, y + 10, px + 10, y + 23, px + 4, y + 40, px + 17, y + 60, px + 8, y + s - 10], false).stroke({ color: 0xffca77, width: 2, alpha: .75 });
      }
      g.poly([x + s*.5, y + s*.28, x + s*.72, y + s*.7, x + s*.28, y + s*.7]).fill({ color: 0x1a1410, alpha: .7 }).stroke({ color: 0xffd69a, width: 2 });
      g.moveTo(x + s*.5, y + s*.4).lineTo(x + s*.5, y + s*.55).stroke({ color: 0xffd69a, width: 3 });
      g.circle(x + s*.5, y + s*.62, 2).fill(0xffd69a);
    } else if (tile.terrain === 'FIRE' || tile.terrain === 'ICE') {
      // Keep the stone visible; the illustrated persistent layer owns flame/frost.
      g.roundRect(x+5,y+5,s-10,s-10,8).fill({color:tile.terrain==='FIRE'?0x381b10:0x96c9da,alpha:.10});
    } else if (tile.terrain === 'SMOKE') {
      // Readable ground veil: restrained layered wisps and a sight-blocking smoke glyph.
      g.roundRect(x+3,y+3,s-6,s-6,10).fill({color:0x342b3e,alpha:.3});
      for (const [dx, dy, r] of [[30, 34, 26], [62, 40, 24], [46, 64, 28], [24, 66, 18], [72, 70, 18]] as const)
        g.ellipse(x + dx, y + dy, r, r * .6).fill({ color: 0xaaa0b5, alpha: 0.18 });
      g.roundRect(x + 5, y + 5, s - 10, s - 10, 8).stroke({color: 0xb1a3be, alpha: .46, width: 1.5});
      g.moveTo(x+34,y+57).bezierCurveTo(x+18,y+39,x+57,y+51,x+42,y+31)
        .moveTo(x+53,y+60).bezierCurveTo(x+72,y+41,x+45,y+40,x+62,y+24)
        .stroke({color:0xd6c7dd,alpha:.75,width:2});
    } else if (tile.terrain === 'OBJECTIVE') {
      // A real escape destination: bright corner brackets and an unmistakable gold threshold.
      for (const [dx, dy, sign] of [
        [8, 8, 1],
        [s - 8, s - 8, -1],
      ])
        g.moveTo(x + dx!, y + dy! + sign! * 18)
          .lineTo(x + dx!, y + dy!)
          .lineTo(x + dx! + sign! * 18, y + dy!)
          .stroke({ color: 0xffdf93, width: 3, alpha: 0.9 });
      g.circle(x + s / 2, y + s / 2, 36).fill({ color: 0xf6ce73, alpha: 0.09 });
      g.circle(x + s / 2, y + s / 2, 31).stroke({ color: 0xd2b46e, width: 2, alpha: 0.85 });
      g.circle(x + s / 2, y + s / 2, 25).stroke({ color: 0xd2b46e, width: 1, alpha: 0.4 });
      g.poly([x + 48, y + 20, x + 62, y + 44, x + 48, y + 60, x + 34, y + 44]).stroke({
        color: 0xffdf93,
        width: 2,
      });
      g.moveTo(x + 48, y + 30)
        .lineTo(x + 48, y + 51)
        .stroke({ color: 0xffdf93, width: 3 });
    }
  });
  return g;
}

function continueTileRim(g: Graphics, x: number, y: number, s: number) {
  g.moveTo(x + 4, y + s - 5)
    .lineTo(x + 4, y + 4)
    .lineTo(x + s - 5, y + 4)
    .stroke({ color: 0x72818a, width: 1, alpha: 0.35 });
}

// ── Projected platform ─────────────────────────────────────────────────────────────────────
// Everything below is drawn in world space through GridProjection: the board is a physical stone
// platform with a rim, a front fascia with thickness and supports that fall away into fog.

const RIM = 0.3; // rim width, in cells
const FASCIA = 40; // front face height, world units
const pts = (points: readonly Point[]) => points.flatMap((p) => [p.x, p.y]);
const down = (p: Point, d: number): Point => ({ x: p.x, y: p.y + d });
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Painted stone of Checkpoint 05, tinted per surface (keeps one material language). */
function stone(tint: number) {
  const texture = paintedCharacter('stone');
  return texture ? { texture, textureSpace: 'local' as const, color: tint } : tint;
}

/** Small ruined stone block (lit top, front face, dark left edge) sitting on a lower terrace. */
function block(g: Graphics, c: Point, w: number, h: number, d: number) {
  g.ellipse(c.x - 4, c.y + 2, w * 0.75, d * 0.6).fill({ color: 0x000000, alpha: 0.35 });
  g.poly([c.x - w / 2, c.y, c.x + w / 2, c.y, c.x + w / 2, c.y - h, c.x - w / 2, c.y - h]).fill(
    stone(0x4d565e),
  );
  g.poly([
    c.x - w / 2,
    c.y - h,
    c.x + w / 2,
    c.y - h,
    c.x + w / 2 - 3,
    c.y - h - d,
    c.x - w / 2 + 3,
    c.y - h - d,
  ]).fill(stone(0x8d969c));
  g.moveTo(c.x - w / 2, c.y - h)
    .lineTo(c.x - w / 2, c.y)
    .stroke({ color: 0x0a1016, width: 1 });
}

export interface PlatformArt {
  /** Behind the playable surface: shadow, supports, fascia, rim, back parapet. */
  back: Graphics;
  /** Upright props on the front rim corners; Y-sorted with actors. */
  props: Container[];
}

function blockedAt(state: Readonly<GameState>, x: number, y: number): boolean {
  const { board } = state;
  if (x < 0 || y < 0 || x >= board.width || y >= board.height) return false;
  return ['BLOCKED', 'VOID'].includes(board.tiles[y * board.width + x]?.terrain ?? '');
}

/** Stone platform around the projected board. Static: rebuilt only when board/projection changes. */
export function drawPlatform(state: Readonly<GameState>, proj: GridProjection): PlatformArt {
  const theme = encounterIdentity(state.scenarioId);
  const fracture = theme.theme === 'fracture',
    sanctuary = theme.theme === 'sanctuary',
    temple = theme.theme === 'temple_mechanism';
  const g = new Graphics();
  const C = proj.cols,
    R = proj.rows;
  const P = (u: number, v: number) => proj.project(u, v);
  // Lower ruined terrace: a wider, darker tier one fascia below the arena — the platform reads as
  // the top of a structure, and its sides give the board visible mass beyond the playable rim.
  const TERRACE = { side: 0.85, front: 0.5, back: 0.7, drop: FASCIA, face: 30 };
  const tA = down(P(-RIM - TERRACE.side, -RIM + TERRACE.back), TERRACE.drop),
    tD = down(P(-RIM - TERRACE.side, R + RIM + TERRACE.front), TERRACE.drop);
  const bottom = tD.y + TERRACE.face;

  // 1. Soft shadow of the whole platform on the void / distant floor behind it.
  for (let i = 0; i < 5; i++)
    g.ellipse(0, bottom + 30 + i * 6, proj.frontWidth * (0.62 - i * 0.05), 70 + i * 10).fill({
      color: 0x000000,
      alpha: 0.11,
    });

  // 1b. Terrace: projected grid of stone slabs (same perspective as the board). In the broken
  // gallery, outer slabs are missing and the void shows through.
  const TU0 = -RIM - TERRACE.side,
    TU1 = C + RIM + TERRACE.side,
    TV0 = -RIM + TERRACE.back,
    TV1 = R + RIM + TERRACE.front;
  const nu = Math.round((TU1 - TU0) / 0.62),
    nv = Math.round((TV1 - TV0) / 0.62);
  const T = (i: number, j: number) =>
    down(P(TU0 + ((TU1 - TU0) * i) / nu, TV0 + ((TV1 - TV0) * j) / nv), TERRACE.drop);
  const missing = (i: number, j: number) =>
    (state.board.tiles.some((t) => t.terrain === 'VOID') &&
      blockedAt(
        state,
        Math.floor(TU0 + ((TU1 - TU0) * (i + 0.5)) / nu),
        Math.floor(TV0 + ((TV1 - TV0) * (j + 0.5)) / nv),
      )) ||
    i < 0 ||
    i >= nu ||
    j >= nv ||
    ((i === 0 || i === nu - 1 || j === nv - 1) && noise(i * 31 + j * 7) > (fracture ? 0.45 : 0.79));
  const tints = temple
    ? [0x3d4648, 0x384143, 0x434c4d]
    : sanctuary
    ? [0x58656f, 0x4f5c66, 0x5e6b75]
    : fracture
      ? [0x4b4d56, 0x45474f, 0x52545c]
      : [0x5b6268, 0x535a60, 0x60676c];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      if (missing(i, j)) continue;
      const q = [T(i, j), T(i + 1, j), T(i + 1, j + 1), T(i, j + 1)];
      g.poly(pts(q))
        .fill(stone(tints[Math.floor(noise(i * 13 + j * 17) * 3)]!))
        .stroke({ color: 0x0a1016, width: 1.2, alpha: 0.9 });
      if (missing(i, j + 1)) {
        // Exposed front face of this slab's course.
        const face = fracture ? TERRACE.face * (0.6 + noise(i * 5 + j) * 0.7) : TERRACE.face;
        const [, , c, d] = q as [Point, Point, Point, Point];
        g.poly(pts([d, c, down(c, face), down(d, face)])).fill(stone(0x343b42));
        g.moveTo(d.x, d.y).lineTo(c.x, c.y).stroke({ color: theme.light, width: 1, alpha: 0.22 });
        g.moveTo(c.x, c.y + 2)
          .lineTo(c.x, c.y + face)
          .stroke({ color: 0x080e15, width: 1.5 });
      }
    }
  g.poly(pts([tA, tD]), false).stroke({ color: theme.light, width: 1, alpha: 0.18 });
  // Fallen blocks and a broken column stump on the side terraces (decoration only).
  // Authored for the 7×5 board; positions scale with the board so larger arenas stay dressed.
  const sx = C / 7,
    sy = R / 5;
  for (const [u, v, w, h] of [
    [-RIM - 0.45, 1.1, 30, 14],
    [-RIM - 0.55, 3.3, 22, 26],
    [C + RIM + 0.5, 1.6, 26, 18],
    [C + RIM + 0.42, 3.8, 34, 12],
  ] as const) {
    const c = down(P(u, v * sy), TERRACE.drop);
    const s = proj.scaleAtY(c.y);
    block(g, c, w * s, h * s, 8 * s);
  }

  // 2. Supports: piers (or broken chunks) under the fascia, fading into fog.
  const piers = (fracture ? [0.9, 2.6, 5.2, 6.4] : [0.15, 1.8, 3.5, 5.2, 6.85]).map((u) => u * sx);
  for (const [k, u] of piers.entries()) {
    const top = P(u, R + RIM);
    const width = fracture ? 30 + (k % 2) * 16 : 46;
    const length = fracture ? 50 + (k % 3) * 26 : 120 + (k % 2) * 30;
    const taper = fracture ? 0.45 : 0.82;
    for (let band = 0; band < 6; band++) {
      const y0 = bottom + (length * band) / 6,
        y1 = bottom + (length * (band + 1)) / 6;
      const w0 = width * (1 - ((1 - taper) * band) / 6),
        w1 = width * (1 - ((1 - taper) * (band + 1)) / 6);
      g.poly([top.x - w0 / 2, y0, top.x + w0 / 2, y0, top.x + w1 / 2, y1, top.x - w1 / 2, y1]).fill(
        {
          color: band % 2 ? 0x121b24 : 0x16212b,
          alpha: 0.95 - band * 0.15,
        },
      );
    }
    // Lit edge on the right (key light from upper front-right) and a dark core on the left.
    g.moveTo(top.x + width / 2 - 2, bottom)
      .lineTo(top.x + (width * taper) / 2 - 2, bottom + length * 0.7)
      .stroke({ color: theme.light, width: 1.5, alpha: 0.16 });
    g.rect(top.x - width * 0.42, bottom, width * 0.3, length * 0.55).fill({
      color: 0x05090f,
      alpha: 0.35,
    });
    if (!fracture && k < piers.length - 1) {
      // Arch between piers just under the fascia.
      const next = P(piers[k + 1]!, R + RIM);
      const mid = (top.x + next.x) / 2;
      g.moveTo(top.x + width / 2, bottom + 34)
        .quadraticCurveTo(mid, bottom + 4, next.x - width / 2, bottom + 34)
        .stroke({ color: 0x1a2631, width: 9, alpha: 0.85 });
    }
  }
  if (fracture)
    // Debris drifting under the broken platform.
    for (let i = 0; i < 9; i++) {
      const x = -proj.frontWidth * 0.45 + noise(i * 13) * proj.frontWidth * 0.9;
      const y = bottom + 30 + noise(i * 29) * 90,
        r = 4 + noise(i * 7) * 9;
      g.poly([
        x - r,
        y,
        x - r * 0.3,
        y - r * 0.8,
        x + r,
        y - r * 0.2,
        x + r * 0.4,
        y + r * 0.6,
      ]).fill({
        color: 0x1d2530,
        alpha: 0.85 - (y - bottom) / 160,
      });
    }

  // 3. Front fascia: one segment per column, so a BLOCKED front tile breaks the platform edge.
  for (let u = -1; u <= C; u++) {
    const a = P(u < 0 ? -RIM : u, R + RIM),
      b = P(u >= C ? C + RIM : u + 1, R + RIM);
    const broken = u >= 0 && u < C && blockedAt(state, u, R - 1);
    if (broken) {
      // Jagged tear: the rim and fascia have collapsed into the void.
      const jag = [a, lerp(a, b, 0.2), lerp(a, b, 0.45), lerp(a, b, 0.7), lerp(a, b, 0.88), b];
      g.poly(
        pts([
          a,
          ...jag.slice(1, -1).map((p, i) => down(p, 6 + (i % 2) * 14)),
          b,
          down(b, 18),
          down(a, 22),
        ]),
      ).fill({ color: 0x0c131b, alpha: 0.9 });
      continue;
    }
    g.poly(pts([a, b, down(b, FASCIA), down(a, FASCIA)])).fill(stone(0x4a535b));
    // Running-bond masonry: two courses, offset joints.
    const course = FASCIA / 2;
    g.moveTo(a.x, a.y + course)
      .lineTo(b.x, b.y + course)
      .stroke({ color: 0x0a1118, width: 2 });
    for (const [t, row] of [
      [0, 0],
      [0.5, 0],
      [0.25, 1],
      [0.75, 1],
    ] as const) {
      const p = lerp(a, b, t);
      g.moveTo(p.x, p.y + row * course + 1)
        .lineTo(p.x - 1, p.y + (row + 1) * course - 1)
        .stroke({ color: 0x080e15, width: 2 });
    }
    // Chipped highlights and a darker foot.
    g.moveTo(a.x, a.y + 2)
      .lineTo(b.x, b.y + 2)
      .stroke({ color: theme.light, width: 1.5, alpha: 0.35 });
    g.poly(pts([down(a, FASCIA - 9), down(b, FASCIA - 9), down(b, FASCIA), down(a, FASCIA)])).fill({
      color: 0x05090e,
      alpha: 0.65,
    });
    if (fracture && noise(u * 37 + 5) > 0.55) {
      const p = lerp(a, b, 0.3 + noise(u) * 0.4);
      g.poly([
        p.x - 12,
        p.y + FASCIA,
        p.x - 3,
        p.y + FASCIA - 14,
        p.x + 9,
        p.y + FASCIA - 6,
        p.x + 14,
        p.y + FASCIA,
      ]).fill(0x05090e);
    }
  }

  // 4. Rim (top surface around the tiles), segmented per cell so BLOCKED edges can break it.
  const rimFill = sanctuary ? 0x8295a3 : fracture ? 0x7a7c86 : 0x8a9096;
  const segment = (quad: Point[], broken: boolean) => {
    if (broken) {
      g.poly(pts(quad)).fill({ color: 0x03070c, alpha: 0.9 });
      return;
    }
    g.poly(pts(quad)).fill(stone(rimFill)).stroke({ color: 0x0b1219, width: 1.5 });
  };
  for (let x = 0; x < C; x++) {
    segment([P(x, -RIM), P(x + 1, -RIM), P(x + 1, 0), P(x, 0)], blockedAt(state, x, 0));
    segment([P(x, R), P(x + 1, R), P(x + 1, R + RIM), P(x, R + RIM)], blockedAt(state, x, R - 1));
  }
  for (let y = 0; y < R; y++) {
    segment([P(-RIM, y), P(0, y), P(0, y + 1), P(-RIM, y + 1)], blockedAt(state, 0, y));
    segment([P(C, y), P(C + RIM, y), P(C + RIM, y + 1), P(C, y + 1)], blockedAt(state, C - 1, y));
  }
  for (const [u, v] of [
    [-RIM, -RIM],
    [C, -RIM],
    [C, R],
    [-RIM, R],
  ] as const)
    segment([P(u, v), P(u + RIM, v), P(u + RIM, v + RIM), P(u, v + RIM)], false);
  // Lit outer edge, dark inner bevel where the tiles sit slightly lower than the rim.
  g.poly(pts([P(-RIM, -RIM), P(C + RIM, -RIM), P(C + RIM, R + RIM), P(-RIM, R + RIM)])).stroke({
    color: theme.light,
    width: 1.5,
    alpha: 0.32,
  });
  g.poly(pts([P(0, 0), P(C, 0), P(C, R), P(0, R)])).stroke({
    color: 0x05090e,
    width: 3,
    alpha: 0.9,
  });

  // 5. Back parapet: low upright blocks give the far edge real height.
  for (let x = -RIM; x < C + RIM - 0.05; x += 0.7) {
    if (blockedAt(state, Math.floor(x), 0) && x >= 0) continue;
    const a = P(x + 0.06, -RIM),
      b = P(Math.min(C + RIM, x + 0.58), -RIM);
    const h = fracture ? 6 + noise(Math.round(x * 10)) * 14 : 13;
    g.poly(pts([down(a, -h), down(b, -h), b, a]))
      .fill(stone(0x4f5961))
      .stroke({ color: 0x0a1118, width: 1 });
    g.poly(pts([down(a, -h - 4), down(b, -h - 4), down(b, -h), down(a, -h)])).fill(stone(0x9aa3a8));
  }

  // Hanging iron chains break the silhouette beneath the dressed rim, outside playable cells.
  for (const u of [C * 0.12, C * 0.79]) {
    const anchor = P(u, R + RIM);
    for (let k = 0; k < 9; k++) {
      const cx = anchor.x + Math.sin(k * 0.18) * 9;
      const cy = anchor.y + FASCIA + 8 + k * 10;
      g.ellipse(cx, cy, k % 2 ? 2 : 4, 6).stroke({
        color: 0x697077,
        alpha: 0.46 - k * 0.035,
        width: 1.5,
      });
    }
  }

  // 6. Fog bank over the supports, in the encounter's light.
  for (let i = 0; i < 4; i++)
    g.ellipse(0, bottom + 70 + i * 22, proj.frontWidth * (0.55 + i * 0.08), 26 + i * 6).fill({
      color: theme.light,
      alpha: sanctuary ? 0.045 : 0.03,
    });

  // Sparse architecture strictly outside the playable surface, behind actors and overlays.
  const dressing = battlefieldStyle(state.scenarioId);
  for (const side of [-1, 1]) {
    const u = side < 0 ? -0.8 : C + 0.8;
    for (const v of [R * 0.28, R * 0.7]) {
      const p = down(P(u, v), TERRACE.drop),
        scale = proj.scaleAtY(p.y);
      block(g, p, 30 * scale, (dressing === 'fractured' ? 9 : 17) * scale, 12 * scale);
      if (dressing === 'weathered' || dressing === 'fractured')
        block(
          g,
          { x: p.x + side * 18 * scale, y: p.y + 13 * scale },
          17 * scale,
          6 * scale,
          8 * scale,
        );
    }
  }
  // Back-rim heraldry gives the arena a focal frame without a new interactive object.
  for (const u of [C * 0.22, C * 0.78]) {
    const p = P(u, -0.55),
      scale = proj.scaleAtY(p.y);
    const tall = dressing === 'citadel' ? 55 : 34;
    block(g, p, 23 * scale, tall * scale, 10 * scale);
    if (dressing === 'ceremonial' || dressing === 'citadel') {
      const color = dressing === 'ceremonial' ? 0x315468 : 0x542e31;
      g.poly([
        p.x - 8 * scale,
        p.y - (tall - 5) * scale,
        p.x + 8 * scale,
        p.y - (tall - 5) * scale,
        p.x + 8 * scale,
        p.y - 10 * scale,
        p.x,
        p.y - 5 * scale,
        p.x - 8 * scale,
        p.y - 10 * scale,
      ])
        .fill(color)
        .stroke({ color: 0xb7a16d, width: 1, alpha: 0.65 });
    }
  }

  // 7. Upright corner props on the rim (back ones behind everything, front ones Y-sorted).
  const props: Container[] = [];
  const corners = [
    P(-RIM / 2, -RIM / 2),
    P(C + RIM / 2, -RIM / 2),
    P(-RIM / 2, R + RIM / 2),
    P(C + RIM / 2, R + RIM / 2),
  ];
  corners.forEach((p, i) => {
    if (isVeilEncounter(state.scenarioId)) {
      const prop = veilProp(i < 2 ? 'veil_tree' : 'veil_brambles', TILE * (i < 2 ? 1.05 : .4) * proj.scaleAtY(p.y));
      prop.position.set(p.x,p.y); prop.zIndex = proj.depthAtPoint(p); props.push(prop); return;
    }
    const front = i >= 2;
    const s = proj.scaleAtY(p.y);
    const prop = front ? new Graphics() : g;
    const ox = front ? 0 : p.x,
      oy = front ? 0 : p.y;
    drawCornerProp(prop, ox, oy, s, theme.theme, i);
    if (front) {
      prop.position.set(p.x, p.y);
      prop.zIndex = proj.depthAtPoint(p);
      props.push(prop);
    }
  });
  if (isVeilEncounter(state.scenarioId)) {
    state.board.tiles.forEach((tile,i) => {
      if (tile.terrain !== 'COVER') return;
      const p = proj.getUnitAnchor({x:i % C,y:Math.floor(i/C)});
      const prop = veilProp('veil_cover',TILE * .34 * proj.scaleAtY(p.y));
      prop.position.set(p.x,p.y); prop.zIndex=proj.depthAtPoint(p); props.push(prop);
    });
    const p = P(C + .65, R * .52), prop = veilProp(veilStage(state.scenarioId)==='trail' ? 'veil_camp' : 'veil_relic', TILE * .65 * proj.scaleAtY(p.y));
    prop.position.set(p.x,p.y); prop.zIndex=proj.depthAtPoint(p); props.push(prop);
  }
  if (theme.theme === 'infernal_forge') {
    // Modular dressing outside all playable cells; composition varies by authored encounter.
    const variant = Number(state.scenarioId.slice(-2));
    for (const side of [-1, 1]) {
      const u = side < 0 ? -RIM - .5 : C + RIM + .5;
      for (let k = 0; k < 3; k++) {
        const p = P(u, (k + .5) * R / 3);
        const sc = proj.scaleAtY(p.y);
        const painting = paintedCharacter('infernal_cage_support');
        if (painting) {
          const prop = new Container();
          const shadow = new Graphics();
          shadow.ellipse(0, 0, 19 * sc, 6 * sc).fill({ color: 0x030306, alpha: .5 });
          prop.addChild(shadow);
          const sprite = new Sprite(painting);
          sprite.anchor.set(.5, .94);
          sprite.scale.set(100 * sc / painting.height);
          if (side > 0) sprite.scale.x *= -1;
          prop.addChild(sprite);
          prop.position.set(p.x, p.y);
          prop.zIndex = proj.depthAtPoint(p);
          props.push(prop);
          continue;
        }
        // Bounded fallback only when the painted asset fails to load.
        g.context.save();
        g.context.translate(p.x, p.y);
        g.context.scale(sc, sc);
        drawInfernalIronwork(g, variant % 3 === 1 ? 'cage' : 'furnace', 36);
        g.context.restore();
      }
    }
    const edge = [P(-RIM,R+RIM),P(C+RIM,R+RIM)];
    g.poly(pts(edge),false).stroke({color:0xff9847,width:4,alpha:.55});
  }
  return { back: g, props };
}

function drawCornerProp(g: Graphics, x: number, y: number, s: number, theme: string, i: number) {
  const w = 15 * s,
    h = (theme === 'fracture' ? 18 + (i % 2) * 14 : 34) * s;
  g.ellipse(x - 3, y + 2, w * 1.5, w * 0.6).fill({ color: 0x000000, alpha: 0.45 });
  // Square stone post: right face lit by the key light, left face in shade.
  g.poly([x - w, y, x - w, y - h, x, y - h - 4 * s, x, y + 4 * s]).fill(0x1a232b);
  g.poly([x, y + 4 * s, x, y - h - 4 * s, x + w, y - h, x + w, y]).fill(0x2f3a43);
  if (theme === 'fracture') {
    g.poly([x - w, y - h, x - w * 0.2, y - h - 7 * s, x + w, y - h + 2 * s, x, y - h + 3 * s]).fill(
      0x3d4650,
    );
    return;
  }
  g.poly([x - w - 3, y - h, x, y - h - 6 * s, x + w + 3, y - h, x, y - h + 6 * s]).fill(0x46525b);
  if (theme === 'sanctuary') {
    for (const [dx, hh] of [
      [-6, 22],
      [1, 32],
      [7, 18],
    ] as const) {
      const bx = x + dx * s,
        by = y - h - 2 * s;
      g.poly([bx - 4 * s, by, bx, by - hh * s, bx + 4 * s, by]).fill({
        color: 0x8fd8f0,
        alpha: 0.9,
      });
      g.poly([bx, by - hh * s, bx + 4 * s, by, bx + 1 * s, by]).fill({
        color: 0x3f8db0,
        alpha: 0.9,
      });
    }
    g.circle(x, y - h - 16 * s, 26 * s).fill({ color: 0x8acddd, alpha: 0.06 });
    return;
  }
  // Brazier bowl and flame (First Blood and default).
  const by = y - h - 4 * s;
  g.poly([x - 11 * s, by, x + 11 * s, by, x + 7 * s, by + 7 * s, x - 7 * s, by + 7 * s]).fill(
    0x6b5a41,
  );
  // Animated fire and soft illustrated light are owned by EncounterAmbience.

}

/** Projected details on top of the mapped surface: BLOCKED pits get a visible inner back wall. */
export function drawSurfaceDetails(state: Readonly<GameState>, proj: GridProjection): Graphics {
  const g = new Graphics();
  const { board } = state;
  const theme = encounterIdentity(state.scenarioId);
  const C = proj.cols,
    R = proj.rows;
  // Atmospheric depth: the far rows sit slightly in haze (two thin bands, never hiding terrain).
  for (const [v, alpha] of [
    [0.9, 0.05],
    [0.45, 0.05],
  ] as const)
    g.poly(
      pts([proj.project(0, 0), proj.project(C, 0), proj.project(C, v), proj.project(0, v)]),
    ).fill({
      color: theme.light,
      alpha,
    });
  // Light pools from the corner fires / crystals spill onto the nearest tiles.
  if (theme.theme !== 'fracture')
    for (const [u, v] of [
      [0, 0],
      [C, 0],
      [0, R],
      [C, R],
    ] as const) {
      const c = proj.project(u, v),
        f = proj.footprint({ x: Math.min(u, C - 1), y: Math.min(v, R - 1) });
      for (let k = 3; k > 0; k--)
        g.ellipse(c.x, c.y, f.w * 0.5 * k, f.h * 0.5 * k).fill({
          color: theme.light,
          alpha: 0.025,
        });
    }
  board.tiles.forEach((tile, i) => {
    if (tile.terrain === 'LAVA') {
      const c = proj.getTileCenter({ x: i % board.width, y: Math.floor(i / board.width) });
      const f = proj.footprint({ x: i % board.width, y: Math.floor(i / board.width) });
      for (let band = 3; band > 0; band--)
        g.ellipse(c.x, c.y, f.w * (0.22 + band * 0.06), f.h * (0.22 + band * 0.06)).fill({
          color: 0xff963d,
          alpha: 0.035,
        });
    }
    if (tile.terrain !== 'BLOCKED' && tile.terrain !== 'VOID') return;
    const x = i % board.width,
      y = Math.floor(i / board.width);
    const P = (u: number, v: number) => proj.project(x + u, y + v);
    // The pit floor fades to black; the far wall (facing the camera) shows stone courses.
    g.poly(pts([P(0, 0), P(1, 0), P(1, 1), P(0, 1)])).fill({ color: 0x010307, alpha: 0.82 });
    g.poly(pts([P(0, 0), P(1, 0), P(1, 0.5), P(0, 0.5)])).fill({ color: 0x18222c, alpha: 0.95 });
    for (const v of [0.17, 0.34])
      g.poly(pts([P(0, v), P(1, v)]), false).stroke({ color: 0x080e15, width: 2 });
    for (const [u, v0, v1] of [
      [0.3, 0, 0.17],
      [0.72, 0, 0.17],
      [0.5, 0.17, 0.34],
      [0.12, 0.34, 0.5],
      [0.85, 0.34, 0.5],
    ] as const)
      g.poly(pts([P(u, v0), P(u, v1)]), false).stroke({ color: 0x080e15, width: 1.5 });
    g.poly(pts([P(0, 0.32), P(1, 0.32), P(1, 0.5), P(0, 0.5)])).fill({
      color: 0x010307,
      alpha: 0.55,
    });
    g.poly(pts([P(0, 0), P(1, 0)]), false).stroke({ color: theme.light, width: 1.5, alpha: 0.3 });
    // Broken lip and exposed masonry remain inside the real pit footprint.
    for (const u of [0.08, 0.47, 0.79]) {
      g.poly(pts([P(u, 0), P(u + 0.12, 0), P(u + 0.09, 0.13), P(u + 0.03, 0.09)])).fill(
        stone(0x677078),
      );
      g.poly(
        pts([P(u + 0.03, 0.09), P(u + 0.09, 0.13), P(u + 0.08, 0.18), P(u + 0.02, 0.15)]),
      ).fill(stone(0x28313d));
    }
    // Faint glow far below: depth, not a new terrain.
    const c = P(0.5, 0.78),
      f = proj.footprint({ x, y });
    g.ellipse(c.x, c.y, f.w * 0.28, f.h * 0.14).fill({ color: theme.light, alpha: 0.07 });
  });
  return g;
}

/**
 * Obstacle body whose origin is its ground anchor (centre of its base on the projected tile).
 * Painted materials follow OBSTACLE_SPECS; vector fallbacks are shifted onto the same anchor.
 */
export function drawObstacle(defId: string, tile = TILE, infernal = false, forest = false): Container {
  if (defId === 'temple_block') return drawTempleBlock(tile);
  if (forest && (defId === 'pillar' || defId === 'rubble'))
    return veilProp(defId === 'pillar' ? 'veil_tree' : 'veil_brambles', tile * (defId === 'pillar' ? 1.1 : .42));
  if (infernal && defId === 'pillar') {
    const out = new Container(), g = new Graphics();
    const painting = paintedCharacter('infernal_pylon');
    if (painting) {
      g.ellipse(0, 0, tile * .27, tile * .11).fill({ color: 0x030306, alpha: .5 });
      out.addChild(g);
      const sprite = new Sprite(painting);
      sprite.anchor.set(.5, .98);
      sprite.scale.set(tile * 1.12 / painting.height);
      out.addChild(sprite);
      return out;
    }
    // Same ground anchor and visual height as the existing single-cell blocker.
    drawInfernalIronwork(g, 'pylon', tile * 1.12);
    out.addChild(g);return out;
  }
  const spec = obstacleSpec(defId);
  const body = new Container();
  const shadow = new Graphics();
  const r = spec.footprint * tile;
  shadow
    .ellipse(SHADOW_OFFSET.x * tile, SHADOW_OFFSET.y * tile, r * 1.1, r * 0.45)
    .fill({ color: 0x03070d, alpha: 0.55 });
  shadow.ellipse(0, 0, r * 0.75, r * 0.3).fill({ color: 0x000000, alpha: 0.35 });
  body.addChild(shadow);
  const painting = paintedCharacter(defId === 'ice_wall' ? 'ice_obstacle' : defId);
  if (painting) {
    const sprite = new Sprite(painting);
    sprite.anchor.set(spec.anchorX, spec.anchorY);
    sprite.scale.set(spriteScale(spec, painting.height, tile));
    body.addChild(sprite);
    return body;
  }
  const fallback = drawVectorObstacle(defId);
  fallback.position.set(0, -24 * 1.3);
  fallback.scale.set(1.3);
  body.addChild(fallback);
  return body;
}

function drawVectorObstacle(defId: string): Graphics {
  const g = new Graphics();
  if (defId === 'ice_wall') {
    for (const [x, height] of [
      [-22, 34],
      [0, 51],
      [22, 40],
    ]) {
      g.poly([
        x! - 13,
        24,
        x! - 11,
        -height! + 14,
        x!,
        -height!,
        x! + 12,
        -height! + 12,
        x! + 11,
        25,
      ])
        .fill(0x4089aa)
        .stroke({ color: 0xb6efff, width: 1 });
      g.poly([x!, -height!, x! + 2, 20, x! + 11, 25, x! + 12, -height! + 12]).fill(0x8bd9eb);
      g.moveTo(x!, -height! + 5)
        .lineTo(x! + 2, 17)
        .stroke({ color: 0xe2fcff, width: 1.5, alpha: 0.8 });
      g.poly([x! - 8, 12, x! - 3, -8, x! + 1, 15, x! - 5, 22]).fill({
        color: 0xc1f6fb,
        alpha: 0.28,
      });
    }
  } else if (defId === 'rubble') {
    for (const [x, y, r] of [
      [-20, 15, 17],
      [2, 3, 23],
      [24, 18, 15],
    ]) {
      g.poly([
        x! - r!,
        y! + 4,
        x! - r! * 0.6,
        y! - r!,
        x! + r! * 0.5,
        y! - r!,
        x! + r!,
        y! + 5,
        x!,
        y! + r! * 0.6,
      ])
        .fill(0x54616b)
        .stroke({ color: 0x1d2a34, width: 2 });
      g.moveTo(x! - r! * 0.6, y! - r!)
        .lineTo(x!, y! - r! * 0.4)
        .lineTo(x! + r!, y! + 5)
        .stroke({ color: 0x829098, width: 1 });
    }
  } else {
    g.poly([-26, 17, 0, 9, 28, 18, 27, 28, -24, 29])
      .fill(0x27353f)
      .stroke({ color: 0x66757c, width: 1 });
    g.poly([-21, -24, -1, -32, 22, -25, 21, 18, -1, 25, -20, 16])
      .fill(0x4b5e6b)
      .stroke({ color: 0x18242f, width: 2 });
    g.poly([0, -29, 22, -25, 21, 18, 0, 25]).fill(0x2c404f);
    g.poly([-25, -28, -8, -39, 13, -37, 26, -28, 4, -19])
      .fill(0x7d8b91)
      .stroke({ color: 0x273843, width: 2 });
    for (const x of [-14, -7, 8, 15])
      g.moveTo(x, -17).lineTo(x, 14).stroke({ color: 0x152634, alpha: 0.6, width: 2 });
    g.moveTo(-15, -25)
      .lineTo(-4, -15)
      .lineTo(-8, -3)
      .lineTo(-2, 5)
      .stroke({ color: 0x172935, width: 2 });
  }
  if (defId !== 'ice_wall')
    for (let i = 0; i < 9; i++) {
      const x = -22 + noise(i * 17) * 44,
        y = -15 + noise(i * 23) * 34;
      g.moveTo(x, y)
        .lineTo(x + 2 + noise(i) * 3, y - 1)
        .stroke({ color: i % 2 ? 0xb1b9b5 : 0x142430, width: 1, alpha: 0.25 });
    }
  return g;
}

/** Live objective anchors: follows real units, never cached at their initial position. */
export function drawObjectiveFocus(
  g: Graphics,
  proj: GridProjection,
  state: Readonly<GameState>,
): void {
  for (const objective of state.objectives) {
    const def = objective.def;
    if (
      objective.status !== 'IN_PROGRESS' ||
      (def.type !== 'PROTECT_TARGET' && def.type !== 'DEFEAT_TARGET')
    )
      continue;
    const unit = state.units.find((u) => u.id === def.targetUnitId);
    if (!unit || unit.hp <= 0) continue;
    const p = proj.getTileCenter(unit.pos),
      f = proj.footprint(unit.pos);
    const color = def.type === 'PROTECT_TARGET' ? 0xffdf93 : 0xe5a66e;
    g.ellipse(p.x, p.y, f.w * 0.44, f.h * 0.42).fill({ color, alpha: 0.07 });
    // Four gold corner brackets are distinct from faction rings and AoE fills.
    for (const side of [-1, 1])
      for (const end of [-1, 1])
        g.moveTo(p.x + side * f.w * 0.3, p.y + end * f.h * 0.39)
          .lineTo(p.x + side * f.w * 0.43, p.y + end * f.h * 0.39)
          .lineTo(p.x + side * f.w * 0.43, p.y + end * f.h * 0.22)
          .stroke({ color, width: 2, alpha: 0.85 });
  }
}
