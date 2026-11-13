import { useEffect, useRef, type ReactNode } from 'react';
import '../../../styles/hand-scroll.css';
import { handOverflow } from '../handScroll';

/** Owns presentation-only scrolling. Never follows selection or incoming cards automatically. */
export function HandScrollRegion({ children, className }: { children: ReactNode; className: string }) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = region.current!, hand = root.querySelector<HTMLElement>('.hand')!;
    const update = () => {
      const { before: left, after: right } = handOverflow(hand.scrollLeft, hand.clientWidth, hand.scrollWidth);
      root.dataset.before = String(left);
      root.dataset.after = String(right);
      root.querySelector<HTMLButtonElement>('.hand-scroll-prev')!.disabled = !left;
      root.querySelector<HTMLButtonElement>('.hand-scroll-next')!.disabled = !right;
    };
    const resize = new ResizeObserver(update);
    const observeCards = () => { resize.disconnect(); resize.observe(hand); for (const card of hand.children) resize.observe(card); update(); };
    const changes = new MutationObserver(observeCards);
    changes.observe(hand, { childList: true });
    hand.addEventListener('scroll', update, { passive: true });
    observeCards();
    return () => { resize.disconnect(); changes.disconnect(); hand.removeEventListener('scroll', update); };
  }, []);
  const scroll = (direction: number) => {
    const hand = region.current?.querySelector<HTMLElement>('.hand');
    // Explicit navigation only; a draw, resize or selection must never steal a drag/scroll.
    hand?.scrollBy({ left: direction * hand.clientWidth * .7, behavior: 'instant' });
  };
  return <div className="hand-scroll-region" ref={region}>
    <div className={className} tabIndex={0} aria-label="Cartas en la mano; desplaza horizontalmente para ver más" onKeyDown={e => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); scroll(e.key === 'ArrowLeft' ? -1 : 1); }
    }}>{children}</div>
    <button type="button" className="hand-scroll-prev" aria-label="Ver cartas anteriores" onClick={() => scroll(-1)}>‹</button>
    <button type="button" className="hand-scroll-next" aria-label="Ver cartas siguientes" onClick={() => scroll(1)}>›</button>
  </div>;
}
