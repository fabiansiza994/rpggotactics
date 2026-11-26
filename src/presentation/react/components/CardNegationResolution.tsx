import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {GameContent} from '../../../game';
import {MarketCard} from '../../shop/MarketCard';
import {readNegationFrame, subscribeNegation, type NegationFrame} from '../../cards/negationResolution';
import '../../../styles/card-negation-resolution.css';

function paint(node: HTMLElement | null, frame: NegationFrame) {
  if (!node) return;
  const p = Math.max(0, Math.min(1, frame.progress));
  const reduced = frame.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches;
  node.dataset.reduced = String(reduced);
  node.dataset.phase = reduced || p >= .36 ? 'negated' : p >= .10 ? 'channel' : 'reveal';
  node.style.setProperty('--cnr-enter', String(reduced ? 1 : Math.min(1, p / .10)));
  node.style.setProperty('--cnr-exit', String(Math.max(0, (p - .94) / .06)));
  node.style.setProperty('--cnr-beam', String(reduced ? .35 : p < .10 ? 0 : p < .36 ? Math.sin((p - .10) / .26 * Math.PI) : .25));
  node.style.setProperty('--cnr-flow', String(reduced ? 0 : p));
  node.style.setProperty('--cnr-hit', String(reduced ? 0 : p >= .36 && p < .5 ? Math.sin((p - .36) / .14 * Math.PI * 6) * (1 - (p - .36) / .14) : 0));
}
/** Read-only printed faces of two already-public activations. No modal, input capture or extra clock. */
export function CardNegationResolution({content}: {content: GameContent | undefined}) {
  const [shown, setShown] = useState<NegationFrame | null>(null);
  const root = useRef<HTMLElement>(null), active = useRef<NegationFrame | null>(null);
  useEffect(() => {
    const update = (next: NegationFrame | null) => {
      const previous = active.current; active.current = next;
      if (previous?.id !== next?.id) setShown(next);
      if (next) paint(root.current, next);
    };
    update(readNegationFrame());
    const off = subscribeNegation(update);
    // The original input continues unchanged; an attempted action simply clears the decoration.
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.battle, .pvp-match-layout')) active.current?.dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable=true]')) return;
      if (/^[1-9eE]$/.test(event.key) || ['Escape', 'Enter', ' '].includes(event.key)) active.current?.dismiss();
    };
    const hidden = () => { if (document.hidden) active.current?.dismiss(); };
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('pointerdown', pointer, {capture: true, passive: true});
    document.addEventListener('keydown', key, true);
    return () => { off(); document.removeEventListener('visibilitychange', hidden); document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', key, true); };
  }, []);
  useLayoutEffect(() => { if (active.current) paint(root.current, active.current); }, [shown]);
  const source = shown && content?.cards[shown.sourceCardId], target = shown && content?.cards[shown.targetCardId];
  if (!shown || !source || !target) return null;
  return createPortal(<section ref={root} className="card-negation-resolution" data-resolution-id={shown.id} aria-label="Resolución de negación">
    <div className="cnr-panel">
      <header className="cnr-heading"><span>RESOLUCIÓN ARCANA</span><strong>EFECTO NEGADO</strong></header>
      <div className="cnr-pair">
        <figure className="cnr-source"><figcaption><small>CARTA DE NEGACIÓN</small><b>{source.name}</b></figcaption>
          <div className="cnr-face" inert><MarketCard card={source} interactive={false}/></div>
        </figure>
        <div className="cnr-energy" aria-hidden="true"><svg viewBox="0 0 100 60" preserveAspectRatio="none"><path d="M0 30 Q25 8 50 30 T100 30"/><path d="M0 30 Q25 52 50 30 T100 30"/><path d="M0 30 H100"/></svg><span>✧</span></div>
        <figure className="cnr-target"><figcaption><small>CARTA NEGADA</small><b>{target.name}</b></figcaption>
          <div className="cnr-target-face"><div className="cnr-face" inert><MarketCard card={target} interactive={false}/></div>
            <div className="cnr-seal" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="43"/><circle cx="50" cy="50" r="36" strokeDasharray="3 7"/><path d="M28 28 72 72 M72 28 28 72"/><path d="M50 1v12m49 37H87M50 99V87M1 50h12"/></svg><span>NEGADO</span></div>
          </div>
        </figure>
      </div>
      <p className="cnr-summary" role="status" aria-live="polite">{source.name} negó el efecto de {target.name}.</p>
    </div>
  </section>, document.body);
}
