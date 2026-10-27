import { Graphics } from 'pixi.js';
import { paintedCharacter } from './paintedTextures';

/** Static, local-space ironwork. No interaction, RNG, ticker or gameplay footprint. */
export function drawInfernalIronwork(
  g: Graphics,
  kind: 'pylon' | 'cage' | 'furnace',
  height: number,
) {
  const material = paintedCharacter('infernal_basalt');
  const iron = (color: number) =>
    material ? { texture: material, textureSpace: 'local' as const, color } : color;
  const h = height;
  const cage = kind !== 'pylon';
  const w = cage ? 15 : 25;
  const top = -h;
  // Ground contact, inset plinth and right-hand extrusion establish weight and perspective.
  g.ellipse(3, 5, w * 1.38, w * 0.35).fill({ color: 0x020306, alpha: 0.5 });
  g.poly([-w - 5, 0, 0, -8, w + 5, -2, 0, 8])
    .fill(0x15171b)
    .stroke({ color: 0x57433a, width: 1 });
  g.poly([-w - 5, 0, 0, 8, 0, 12, -w - 5, 4]).fill(0x0c1015);
  g.poly([0, 8, w + 5, -2, w + 5, 3, 0, 12]).fill(0x30272a);
  g.poly([-w, 0, -w, top + 5, w - 4, top + 5, w - 4, 0])
    .fill(iron(0x343840))
    .stroke({ color: 0x080c12, width: 2 });
  g.poly([w - 4, 0, w - 4, top + 5, w + 3, top, w + 3, -5]).fill(iron(0x54434a));
  g.poly([-w, top + 5, -w + 7, top - 2, w + 3, top, w - 4, top + 5]).fill(0x655046);
  // Soot-dark recessed cavity; warm backlight is bounded within the iron frame.
  if (cage) {
    g.rect(-w + 4, top + 9, w * 2 - 12, h - 15).fill(0x080c12);
    g.rect(-w + 5, top + 11, w * 2 - 14, h - 20).fill({
      color: kind === 'furnace' ? 0x8d361b : 0x502719,
      alpha: 0.65,
    });
    g.ellipse(-1, -h * 0.35, w * 0.54, h * 0.22).fill({
      color: 0xf18232,
      alpha: kind === 'furnace' ? 0.16 : 0.07,
    });
    for (let i = 0; i < 4; i++) {
      const x = -w + 6 + (i * (w * 2 - 15)) / 3;
      g.poly([x, top + 8, x + 3, top + 8, x + 3, -6, x, -6]).fill(0x11151b);
      g.moveTo(x + 3, top + 10)
        .lineTo(x + 3, -7)
        .stroke({ color: 0xae7049, width: 0.75, alpha: 0.7 });
    }
  } else {
    // Forged panels with a dark centre seam and mottled hammer marks.
    g.poly([-w + 5, -5, -w + 5, top + 10, -3, top + 12, -3, -5]).fill(iron(0x46474e));
    g.poly([1, -5, 1, top + 12, w - 8, top + 10, w - 8, -5]).fill(iron(0x514349));
    g.moveTo(-1, top + 13)
      .lineTo(-1, -7)
      .stroke({ color: 0x080b10, width: 2 });
    g.poly([-6, top + 23, 0, top + 17, 6, top + 23, 0, top + 32]).stroke({
      color: 0xae623a,
      width: 1.6,
      alpha: 0.85,
    });
    g.moveTo(0, top + 35)
      .lineTo(-3, top + 49)
      .lineTo(3, top + 57)
      .stroke({ color: 0xd78244, width: 1, alpha: 0.65 });
  }
  // Broad rolled edges catch light; the centre stays soot-dark instead of a flat outline.
  g.poly([-w, 0, -w, top + 7, -w + 4, top + 10, -w + 4, -3]).fill(0x4c4444);
  g.poly([w - 8, -3, w - 8, top + 10, w - 4, top + 6, w - 4, 0]).fill(0x62504a);
  // Thick crossbands and rivet heads; lit bevels follow the warm furnace light.
  for (const y of [top + 6, -h * 0.46, -5]) {
    g.poly([-w - 2, y, w, y - 1, w, y + 5, -w - 2, y + 6])
      .fill(0x42393a)
      .stroke({ color: 0x14151b, width: 1 });
    g.moveTo(-w - 1, y)
      .lineTo(w - 1, y - 1)
      .stroke({ color: 0xa07856, width: 1, alpha: 0.8 });
    for (const x of [-w + 3, w - 5]) {
      g.circle(x + 1, y + 3, 2).fill(0x11141a);
      g.circle(x, y + 2, 1.4).fill(0x98765b);
      g.circle(x - 0.4, y + 1.5, 0.45).fill(0xd6a16b);
    }
  }
  // Gothic crest and corner teeth keep the silhouette readable even at mobile scale.
  g.poly([
    -w - 3,
    top + 5,
    -w + 3,
    top - 8,
    -w + 8,
    top + 3,
    0,
    top - 5,
    w - 7,
    top + 2,
    w - 2,
    top - 7,
    w + 5,
    top + 4,
  ])
    .fill(0x28282e)
    .stroke({ color: 0x89674e, width: 1 });
  for (let i = 0; i < (cage ? 5 : 14); i++) {
    const x = -w + 5 + ((i * 17) % Math.max(1, w * 2 - 12));
    const y = top + 14 + ((i * 23) % Math.max(1, h - 23));
    g.moveTo(x, y)
      .lineTo(x + 3, y - 1)
      .stroke({ color: i % 2 ? 0x93694a : 0x090d13, width: 0.8, alpha: 0.35 });
  }
  // Shackles and alternating chain links remain inside the original lateral silhouette.
  const chainX = w - 6;
  g.circle(chainX, top + 12, 3).stroke({ color: 0xa28569, width: 1.3 });
  for (let k = 0; k < (cage ? 4 : 7); k++) {
    const y = top + 19 + k * (cage ? 5 : 10);
    g.ellipse(chainX + (k % 2 ? 1 : 0), y, k % 2 ? 1.4 : 2.7, cage ? 3.5 : 5.5).stroke({
      color: 0x0a0d13,
      width: 2.5,
    });
    g.ellipse(chainX + (k % 2 ? 1 : 0), y, k % 2 ? 1.4 : 2.7, cage ? 3.5 : 5.5).stroke({
      color: 0x8e7763,
      width: 1,
    });
  }
  g.moveTo(w + 3, top + 2)
    .lineTo(w + 3, -6)
    .stroke({ color: 0xd38b52, width: 1, alpha: 0.65 });
}
