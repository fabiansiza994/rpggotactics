/** Tolerate fractional device-pixel rounding at either end of the scrollport. */
export function handOverflow(left: number, width: number, total: number) {
  const max = Math.max(0, total - width);
  return { before: left > 2, after: max - Math.max(0, left) > 2 };
}

/** Offscreen draws arrive at the visible edge without moving a user's hand scroll. */
export function handArrivalCenter(center: number, cardWidth: number, left: number, right: number) {
  const half = Math.min(cardWidth / 2, Math.max(0, right - left) / 2);
  return Math.max(left + half, Math.min(right - half, center));
}
