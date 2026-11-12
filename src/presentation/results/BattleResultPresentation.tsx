import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../../styles/battle-result-cinematic.css';

import { createResultHistory, resultDuration, type ResultTone } from './resultPresentationState';
const seen = createResultHistory();
const titles: Record<ResultTone, string> = { victory: 'VICTORIA', defeat: 'DERROTA', draw: 'EMPATE', ended: 'PARTIDA FINALIZADA' };
/** Cosmetic only. Children retain their existing persistence and navigation handlers. */
export function BattleResultPresentation({ identity, tone, children }: {
  identity: object | string; tone: ResultTone; children: ReactNode;
}) {
  const [done, setDone] = useState(() => seen.has(identity) || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const skip = useRef<HTMLButtonElement>(null);
  const cinema = useRef<HTMLElement>(null);
  const skippable = tone !== 'victory' && tone !== 'defeat';
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // An interrupted/remounted sequence is not a completed presentation.
    if (done) { seen.mark(identity); return; }
    (skippable ? skip.current : cinema.current)?.focus();
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => setDone(true);
    const change = () => { if (media.matches) finish(); };
    media.addEventListener('change', change);
    const timer = window.setTimeout(finish, resultDuration(tone));
    return () => { clearTimeout(timer); media.removeEventListener('change', change); };
  }, [identity, tone, done, skippable]);
  useEffect(() => {
    if (done) content.current?.focus();
  }, [done]);
  return <div className={`battle-result-presentation result-${tone}`}>
    <div ref={content} tabIndex={-1} inert={!done} aria-hidden={!done} style={!done ? { visibility: 'hidden' } : undefined}>{children}</div>
    {!done && <section ref={cinema} tabIndex={-1} className="result-cinema" role="dialog" aria-modal="true" aria-label={titles[tone]} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setDone(true); }
      if (event.key === 'Tab') { event.preventDefault(); (skippable ? skip.current : cinema.current)?.focus(); }
    }}>
      <div className="result-cinema-glow" aria-hidden="true" />
      <div className="result-cinema-emblem" aria-hidden="true">{tone === 'victory' ? '✦' : tone === 'defeat' ? '◇' : '⚖'}</div>
      <h1>{titles[tone]}</h1>
      <p>{tone === 'victory' ? 'El campo recuerda tu hazaña' : tone === 'defeat' ? 'La batalla termina. Tu camino continúa.' : tone === 'draw' ? 'Dos fuerzas. Un mismo destino.' : 'Consulta el motivo y resultado confirmado.'}</p>
      {skippable && <button ref={skip} type="button" onClick={() => { setDone(true); }}>Omitir animación</button>}
    </section>}
  </div>;
}
