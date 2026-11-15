import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";

// Inspect shipped PNG pixels, not a CSS approximation: a central aperture is mandatory.
function rgba(name: string) {
  const png = readFileSync(`src/presentation/immersion/assets/${name}.png`);
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(6);
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at),
      type = png.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") chunks.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x,
        a = x >= 4 ? pixels[at - 4]! : 0;
      const b = y ? pixels[at - stride]! : 0,
        c = y && x >= 4 ? pixels[at - stride - 4]! : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][
        filter
      ]!;
      pixels[at] = (raw[y * (stride + 1) + 1 + x]! + predictor) & 255;
    }
  }
  return { width, height, pixels, bytes: png.length };
}
for (const name of ["blood", "roots", "ice", "fire"])
  it(`${name}: transparent center, detailed alpha and bounded asset`, () => {
    const { width, height, pixels, bytes } = rgba(name);
    expect(bytes).toBeLessThan(1_200_000);
    const alphas = new Set<number>();
    let opaqueEdge = 0,
      centerAlpha = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const a = pixels[(y * width + x) * 4 + 3]!;
        alphas.add(a);
        if (
          x > width * 0.3 &&
          x < width * 0.7 &&
          y > height * 0.3 &&
          y < height * 0.7
        )
          centerAlpha = Math.max(centerAlpha, a);
        if (a > 128) opaqueEdge++;
      }
    console.log(name, { centerAlpha });
    expect(centerAlpha).toBeLessThanOrEqual(2);
    expect(alphas.size).toBeGreaterThan(100);
    expect(opaqueEdge).toBeGreaterThan(1000);
  });
it("finite peripheral particles, no input capture and reduced motion override", () => {
  const component = readFileSync(
    "src/presentation/react/components/CombatAtmosphere.tsx",
    "utf8",
  );
  const css = readFileSync("src/styles/combat-immersion.css", "utf8");
  expect(component).toContain("length: 6");
  expect(css).toContain("pointer-events: none !important");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toContain("border-image-slice: 240");
  expect(css).not.toContain("mask-image");
  expect(css).toContain("animation: none !important");
  expect(component).not.toContain("setInterval");
});

it("result cleanup waits for Pixi readiness and the existing playback", () => {
  const board=readFileSync("src/presentation/pixi/BattleCanvas.ts","utf8");
  const method=board.slice(board.indexOf("setImmersionFinished("),board.indexOf("setMenuPaused("));
  expect(method).toContain("if(this.ready&&this.vm)");
  expect(readFileSync("src/presentation/pvp/PvpScreen.tsx","utf8")).toContain("finished={!!snapshot.result && !playback}");
});

it('all environmental animations share the canvas visibility lifecycle, including the heartbeat pseudo-element', () => {
  const canvas=readFileSync('src/presentation/pixi/BattleCanvas.ts','utf8');
  const css=readFileSync('src/styles/combat-immersion.css','utf8');
  expect(canvas).toContain("this.host?.toggleAttribute('data-scene-paused', paused)");
  expect(css).toContain('.board-host[data-scene-paused] .combat-atmosphere *::after');
  expect(css).toContain('animation-play-state: paused !important');
  expect(canvas).toContain("document.removeEventListener('visibilitychange', this.syncVisibility)");
});
