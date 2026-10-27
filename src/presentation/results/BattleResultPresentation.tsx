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
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    seen.mark(identity);
    if (done) return;
    skip.current?.focus();
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => setDone(true);
    const change = () => { if (media.matches) finish(); };
    media.addEventListener('change', change);
    const timer = window.setTimeout(finish, resultDuration(tone));
    return () => { clearTimeout(timer); media.removeEventListener('change', change); };
  }, [identity, tone, done]);
  useEffect(() => {
    if (done) content.current?.focus();
  }, [done]);
  return <div className={`battle-result-presentation result-${tone}`}>
    <div ref={content} tabIndex={-1} inert={!done} aria-hidden={!done} style={!done ? { visibility: 'hidden' } : undefined}>{children}</div>
    {!done && <section className="result-cinema" role="dialog" aria-modal="true" aria-label={titles[tone]} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setDone(true); }
      if (event.key === 'Tab') { event.preventDefault(); skip.current?.focus(); }
    }}>
      <div className="result-cinema-glow" aria-hidden="true" />
      <div className="result-cinema-emblem" aria-hidden="true">{tone === 'victory' ? '✦' : tone === 'defeat' ? '◇' : '⚖'}</div>
      <h1>{titles[tone]}</h1>
      <p>{tone === 'victory' ? 'El campo recuerda tu hazaña' : tone === 'defeat' ? 'La batalla termina. Tu camino continúa.' : tone === 'draw' ? 'Dos fuerzas. Un mismo destino.' : 'Consulta el motivo y resultado confirmado.'}</p>
      <button ref={skip} type="button" onClick={() => { setDone(true); }}>Omitir animación</button>
    </section>}
  </div>;
}
