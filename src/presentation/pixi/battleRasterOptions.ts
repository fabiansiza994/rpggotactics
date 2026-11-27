/** Keep native image detail. At 2x raster resolution, additional MSAA multiplies
 * framebuffer work (measured as 4 samples on integrated Intel) without adding
 * source pixels. Keep MSAA at lower densities, where geometric edges need it.
 * Chosen once per canvas; never changes combat state or oscillates mid-battle. */
export function battleRasterOptions(devicePixelRatio = 1) {
  const density = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const resolution = Math.min(2, density);
  return {resolution, antialias: resolution < 2};
}
