import { describe, it, expect } from 'vitest';
import { Texture } from 'pixi.js';
import type { GameEvent } from '../src/game';
import { PaintedFigure } from '../src/presentation/pixi/unitArt';
import { phase2Feedback } from '../src/presentation/mechanisms/phase2Presentation';
const cues = (...values: string[]) => values.map(cue => ({type:'MECHANISM_CHANGED',cue})) as GameEvent[];
describe('Phase 2 final presentation', () => {
  it('dissolves a visual variant locally and cleans up on interruption/reduced motion', () => {
    const body = new PaintedFigure(Texture.WHITE, 'temple_guardian');
    body.setAnimationVariant('temple_guardian:exposed', true);
    expect(body.children).toHaveLength(2);
    body.advanceVariant(210, false);
    expect(body.children[1]!.alpha).toBeCloseTo(.5);
    body.setAnimationVariant('temple_guardian', true);
    expect(body.children).toHaveLength(2);
    body.advanceVariant(0, true);
    expect(body.children).toHaveLength(1);
    expect(body.children[0]!.alpha).toBe(1);
    body.destroy({children:true});
  });
  it('does not animate restoration or same-state updates', () => {
    const body = new PaintedFigure(Texture.WHITE, 'temple_guardian');
    body.setAnimationVariant('temple_guardian:exposed');
    body.setAnimationVariant('temple_guardian:exposed', true);
    expect(body.children).toHaveLength(1);
    body.destroy({children:true});
  });
  it('reports real sequence progress, completion and wrong-order resets', () => {
    expect(phase2Feedback(cues('SEQUENCE_PROGRESS'))).toBe('SOL DESPIERTO · 1 / 2');
    expect(phase2Feedback(cues('SEQUENCE_PROGRESS','GATE_OPENED'))).toBe('MECANISMO DESBLOQUEADO');
    expect(phase2Feedback(cues('SEQUENCE_RESET'))).toBe('RESONANCIA INTERRUMPIDA');
  });
  it('prioritizes relic cascade and preserves blocked/reset feedback', () => {
    expect(phase2Feedback(cues('RELIC_PICKED_UP','GATE_CLOSED','GATE_OPENED'))).toContain('TEMPLO DESPIERTA');
    expect(phase2Feedback(cues('RELIC_EXTRACTED'))).toBe('RELIQUIA ASEGURADA');
    expect(phase2Feedback(cues('PLATFORM_BLOCKED'))).toBe('CAMINO BLOQUEADO');
    expect(phase2Feedback(cues('MECHANISM_RESET'))).toBe('MECANISMO RESTABLECIDO');
    expect(phase2Feedback([])).toBeNull();
  });
});
