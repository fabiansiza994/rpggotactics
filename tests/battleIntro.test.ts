import { describe, expect, it } from 'vitest';
import { BattleIntroDirector } from '../src/presentation/motion/BattleIntroDirector';
import { introTimeline, type IntroBeat } from '../src/presentation/motion/introTimeline';
import { motionCues, type MotionCue } from '../src/presentation/motion/motionCues';
import { STAGGER, staggerDelay } from '../src/presentation/motion/tokens';

const end = (beat: IntroBeat, steps = introTimeline('FULL', false)) => {
  const s = steps.find((x) => x.beat === beat)!;
  return s.at + s.duration;
};

describe('battle intro timeline', () => {
  for (const variant of ['FULL', 'QUICK'] as const)
    for (const reduced of [false, true])
      it(`${variant}${reduced ? ' reduced' : ''}: unlock is last and after the hand has landed`, () => {
        const steps = introTimeline(variant, reduced);
        const unlock = steps.find((s) => s.beat === 'unlock')!;
        expect(Math.max(...steps.map((s) => s.at))).toBe(unlock.at);
        expect(unlock.at).toBeGreaterThanOrEqual(end('deal', steps));
      });

  it('reads in order: battlefield → lights → HUD → actors → objective → hand → banner', () => {
    const at = (beat: IntroBeat) => introTimeline('FULL', false).find((s) => s.beat === beat)!.at;
    const order: IntroBeat[] = ['battlefield', 'ambience_lights', 'hud', 'player', 'enemies', 'objective', 'deal', 'banner'];
    for (let i = 1; i < order.length; i++) expect(at(order[i]!)).toBeGreaterThan(at(order[i - 1]!));
  });

  it('control returns within the 2.5 s budget (well under it after a restart or reduced motion)', () => {
    expect(introTimeline('FULL', false).find((s) => s.beat === 'unlock')!.at).toBeLessThanOrEqual(1800);
    expect(introTimeline('QUICK', false).find((s) => s.beat === 'unlock')!.at).toBeLessThanOrEqual(700);
    expect(introTimeline('FULL', true).find((s) => s.beat === 'unlock')!.at).toBeLessThanOrEqual(500);
  });
});

describe('BattleIntroDirector', () => {
  it('fires beats once, in order, on its own clock, and emits their motion cues', () => {
    const beats: IntroBeat[] = [];
    const cues: MotionCue[] = [];
    const off = motionCues.subscribe((c) => cues.push(c));
    const director = new BattleIntroDirector((s) => beats.push(s.beat));
    director.start(introTimeline('FULL', false));
    expect(beats).toEqual(['battlefield']);
    expect(director.progress('battlefield')).toBe(0);
    director.tick(290);
    expect(director.progress('battlefield')).toBeCloseTo(0.5, 2);
    expect(director.progress('hud')).toBe(0);
    for (let t = 0; t < 3000; t += 16) director.tick(16);
    off();
    expect(director.active).toBe(false);
    expect(beats).toEqual(introTimeline('FULL', false).map((s) => s.beat));
    expect(cues).toContain('battlefield_enter');
    expect(cues).toContain('turn_start');
  });

  it('a beat missing from the timeline counts as complete (restart keeps the board in place)', () => {
    const director = new BattleIntroDirector(() => {});
    director.start(introTimeline('QUICK', false));
    expect(director.progress('battlefield')).toBe(1);
    expect(director.active).toBe(true);
  });

  it('finish() flushes every remaining beat, including unlock, so input is never stranded', () => {
    const beats: IntroBeat[] = [];
    const director = new BattleIntroDirector((s) => beats.push(s.beat));
    director.start(introTimeline('FULL', false));
    director.finish();
    expect(beats.at(-1)).toBe('unlock');
    expect(director.active).toBe(false);
  });

  it('restarting mid-intro replays from the new timeline without leaking old beats', () => {
    const beats: IntroBeat[] = [];
    const director = new BattleIntroDirector((s) => beats.push(s.beat));
    director.start(introTimeline('FULL', false));
    director.tick(500);
    beats.length = 0;
    director.start(introTimeline('QUICK', false));
    expect(beats).toEqual(['objective']);
  });
});

describe('stagger', () => {
  it('never spreads a group beyond the cap', () => {
    expect(staggerDelay(0, 5, STAGGER.card)).toBe(0);
    expect(staggerDelay(4, 5, STAGGER.card)).toBe(4 * STAGGER.card);
    expect(staggerDelay(9, 10, STAGGER.card)).toBeLessThanOrEqual(STAGGER.cap);
  });
});
