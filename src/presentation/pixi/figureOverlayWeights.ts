/** Spatial weights of the existing painting, independent of animation time.
 * Float64 preserves the original Math.hypot results. One cache per mesh; the
 * caller replaces it when that mesh, variant or texture dimensions change. */
export function figureOverlayWeights(base: Readonly<Float32Array>, width: number, height: number, ritual: boolean) {
  const head = new Float64Array(base.length / 2);
  const arm = ritual ? new Float64Array(base.length / 2) : null;
  for (let i = 0; i < base.length; i += 2) {
    const x = base[i]! / width, y = base[i + 1]! / height;
    head[i / 2] = Math.max(0, 1 - Math.hypot((x - .5) / .2, (y - .25) / .18));
    if (arm) arm[i / 2] = Math.max(0, 1 - Math.hypot((x - .36) / .15, (y - .34) / .12));
  }
  return {head, arm};
}
