import { expect, it } from 'vitest';
import { FrameCadence } from '../src/presentation/qa/act3/frameCadence';
it('finishes synchronously at busy false, without waiting for another idle RAF', () => {
  const s = new FrameCadence();
  s.begin(100);
  s.frame(116);
  s.frame(132);
  s.frame(148);
  expect(s.finish(150)).toEqual({ wallMs: 50, frames: 2, mean: 16, p50: 16, p95: 16, fps: 62.5 });
  expect(s.finish(170)).toBeNull();
});
it('a new cast cannot inherit wall time or frames from the previous cast', () => {
  const s = new FrameCadence();
  s.begin(0);
  s.frame(10);
  s.frame(30);
  s.begin(1000);
  s.frame(1010);
  s.frame(1060);
  const r = s.finish(1080)!;
  expect(r.wallMs).toBe(80);
  expect(r.frames).toBe(1);
  expect(r.fps).toBe(20);
});
it('inspection/reset and slow frames cannot leak into the next normal sample', () => {
  const s = new FrameCadence();
  s.begin(0);
  s.frame(20);
  s.frame(1000);
  s.reset();
  expect(s.finish(1500)).toBeNull();
  s.begin(2000);
  for (let i = 1; i <= 12; i++) s.frame(2000 + i * 20);
  const r = s.finish(2250)!;
  expect(r.frames).toBe(11);
  expect(r.p95).toBe(20);
  expect(r.fps).toBe(50);
});
