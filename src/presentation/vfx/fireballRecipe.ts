import { premiumVfxEnabled } from './premiumVfxRelease';
/** Local visual pilot only. No domain metadata, timers, RNG or authoritative state. */
export const FIREBALL_RECIPE = {
  id: 'fireball-painted-v1',
  columns: 4,
  frames: { core: [0, 1, 2, 3], explosion: [4, 5, 6, 7], smoke: [8, 9, 10, 11], trail: [12], ember: [13], wave: [14], ignition: [15] },
  poolLimit: 32,
  desktop: { size: 1024, embers: 8, smokeMs: 480 },
  mobile: { size: 512, embers: 4, smokeMs: 380 },
} as const;
/** Rollback/A-B switch; read only at the beginning of a batch. Never persisted. */
export const fireballPilot = { premium: true };
export function fireballPilotAllowed(): boolean {
  return premiumVfxEnabled();
}
export function fireballFrame(frames: readonly number[], t: number, loop = false): number {
  const phase = loop ? ((t % 1) + 1) % 1 : Math.min(1, Math.max(0, t));
  return frames[Math.min(frames.length - 1, Math.floor(phase * frames.length))]!;
}
