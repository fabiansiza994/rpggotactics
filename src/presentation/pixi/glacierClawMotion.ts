/** Presentation-only clock. No turn state, damage or network timing belongs here. */
export const CLAW_TIMING = { invocation: 260, emergence: 360, grip: 320, release: 380, fire: 320 } as const;
export type ClawPhase = 'none' | 'enter' | 'hold' | 'release' | 'fire';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
export function clawPose(phase: ClawPhase, elapsed: number, reduced = false) {
  const exit = phase === 'release' || phase === 'fire';
  const rise = phase === 'enter' ? smooth((elapsed - CLAW_TIMING.invocation) / CLAW_TIMING.emergence) : phase === 'none' ? 0 : 1;
  const close = phase === 'enter' ? smooth((elapsed - CLAW_TIMING.invocation - CLAW_TIMING.emergence) / CLAW_TIMING.grip) : 1;
  const fracture = exit ? clamp(elapsed / (phase === 'fire' ? CLAW_TIMING.fire : CLAW_TIMING.release)) : 0;
  const end = phase === 'enter' && (reduced || elapsed >= 940) ? 'hold' : exit && (reduced || fracture >= 1) ? 'none' : phase;
  return { phase: end as ClawPhase, rise: reduced && phase === 'enter' ? 1 : rise, close: reduced ? 1 : close, fracture, alpha: phase === 'none' || end === 'none' ? 0 : exit ? 1 - fracture : 1, ground: phase === 'enter' ? smooth(elapsed / 260) : 1 };
}
/** Proportional presentation scale from the existing unit render contract. */
export const clawScaleForUnit=(height:number,sizeScale=1)=>Math.max(.45,Math.min(2.4,height*sizeScale/112));
