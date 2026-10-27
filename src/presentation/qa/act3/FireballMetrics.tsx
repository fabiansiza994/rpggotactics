import { useEffect, useRef, useState } from 'react';
import { FrameCadence } from './frameCadence';
/** DEV laboratory only: RAF intervals are a frame-cadence proxy, not GPU timings. */
export function FireballMetrics({
  busy,
  inspection = false,
}: {
  busy: boolean;
  inspection?: boolean;
}) {
  const sampler = useRef(new FrameCadence());
  const [result, setResult] = useState('Sin muestra');
  useEffect(() => {
    if (inspection) {
      sampler.current.reset();
      return;
    }
    if (!busy) {
      // Finalize at the state transition, before another click can cancel the next idle RAF.
      const sample = sampler.current.finish(performance.now());
      if (sample)
        setResult(
          sample.frames < 8
            ? `${Math.round(sample.wallMs)} ms · ${sample.frames} frames · muestra insuficiente`
            : `${Math.round(sample.wallMs)} ms · ${sample.frames} frames · ${sample.p50.toFixed(1)} ms p50 · ${sample.mean.toFixed(1)} ms media · ${sample.p95.toFixed(1)} ms p95 · ${sample.fps.toFixed(1)} FPS RAF`,
        );
      return;
    }
    sampler.current.begin(performance.now());
    let id = 0;
    const tick = (now: number) => {
      sampler.current.frame(now);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [busy, inspection]);
  return (
    <output aria-label="Métricas visuales QA" style={{ display: 'block', fontSize: 11 }}>
      {inspection ? 'Inspección: medición excluida' : result}
    </output>
  );
}
