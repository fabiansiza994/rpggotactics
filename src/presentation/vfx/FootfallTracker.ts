/** Contact beats follow actual atlas frames, never a timer independent of the sprite. */
export class FootfallTracker {
  private readonly previous = new Map<string, { frame: number; x: number; y: number }>();
  update(id: string, frame: number, count: number, x: number, y: number, moving: boolean) {
    const last = this.previous.get(id);
    if (!moving || count < 2) {
      this.previous.delete(id);
      return null;
    }
    this.previous.set(id, { frame, x, y });
    if (last?.frame === frame) return null;
    const foot = frame === 0 ? 0 : frame === Math.floor(count / 2) ? 1 : null;
    if (foot === null) return null;
    const dx = last ? x - last.x : 0,
      dy = last ? y - last.y : 0,
      length = Math.hypot(dx, dy) || 1;
    return { foot, dx: dx / length, dy: dy / length };
  }
  clear() {
    this.previous.clear();
  }
}
