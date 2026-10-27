import { useCosmeticCard } from '../cosmetics/cardCosmetics';
import { useEffect, useRef } from 'react';
import type { CardDefinition } from '../../game';
import { premiumIdentity, premiumPointer, cardRarityFinish } from './premiumTreatment';
import '../../styles/card-premium.css';

export type PremiumSurface = 'large' | 'compact' | 'grid';
/** Event-driven DOM effect. No React state during movement, sensor permissions or RAF loop. */
export function useCardPremiumEffect<T extends HTMLElement>(
  card: CardDefinition | undefined,
  surface: PremiumSurface,
  selected = false,
  interactive = true,
) {
  const visualCard = useCosmeticCard(card);
  const ref = useRef<T>(null);
  const identity = card
    ? premiumIdentity(visualCard ?? card)
    : { treatment: 'none', family: 'neutral', motif: 'arcane' };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.cardId = card?.id ?? '';
    el.dataset.cardOrigin = card?.heroId === undefined ? 'neutral' : 'champion';
    el.dataset.premiumTreatment = identity.treatment;
    el.dataset.rarityFinish = visualCard ? cardRarityFinish(visualCard) : '';
    el.dataset.premiumSurface = surface;
    el.dataset.premiumFamily = identity.family;
    el.dataset.premiumMotif = identity.motif;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0,
      sweepFrame = 0,
      bounds: DOMRect | null = null,
      touching = false;
    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      bounds = null;
      touching = false;
      el.dataset.premiumActive = 'false';
      for (const [key, value] of Object.entries({
        '--cp-x': '0',
        '--cp-y': '0',
        '--cp-rx': '0deg',
        '--cp-ry': '0deg',
        '--cp-lx': '50%',
        '--cp-ly': '50%',
      }))
        el.style.setProperty(key, value);
    };
    const sweep = () => {
      if (media.matches || identity.treatment === 'none' || surface === 'grid') return;
      el.dataset.premiumSweep = 'false';
      sweepFrame = requestAnimationFrame(() => {
        sweepFrame = 0;
        if (el.isConnected) el.dataset.premiumSweep = 'true';
      });
    };
    const enter = (event: PointerEvent) => {
      if (
        media.matches ||
        !interactive ||
        (identity.treatment === 'none' && surface !== 'large') ||
        event.pointerType === 'touch'
      )
        return;
      bounds = el.getBoundingClientRect();
      el.dataset.premiumActive = 'true';
    };
    const down = (event: PointerEvent) => {
      if (
        media.matches ||
        !interactive ||
        surface !== 'large' ||
        (identity.treatment === 'none' && surface !== 'large') ||
        event.pointerType !== 'touch'
      )
        return;
      touching = true;
      bounds = el.getBoundingClientRect();
      el.dataset.premiumActive = 'true';
    };
    const move = (event: PointerEvent) => {
      if (
        media.matches ||
        !interactive ||
        (identity.treatment === 'none' && surface !== 'large') ||
        (event.pointerType === 'touch' && !touching)
      )
        return;
      bounds ??= el.getBoundingClientRect();
      const max =
        surface === 'large'
          ? identity.treatment === 'none'
            ? 2
            : identity.treatment === 'subtle'
              ? 3
              : identity.treatment === 'showcase'
                ? 4
                : 6
          : 1.5;
      const sample = premiumPointer(event.clientX, event.clientY, bounds, max);
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        el.style.setProperty('--cp-x', String(sample.x));
        el.style.setProperty('--cp-y', String(sample.y));
        el.style.setProperty('--cp-rx', `${sample.angleX}deg`);
        el.style.setProperty('--cp-ry', `${sample.angleY}deg`);
        el.style.setProperty('--cp-lx', `${sample.lightX}%`);
        el.style.setProperty('--cp-ly', `${sample.lightY}%`);
        el.dataset.premiumActive = 'true';
      });
    };
    reset();
    el.dataset.premiumSweep = 'false';
    if (interactive && (surface === 'large' || selected)) sweep();
    el.addEventListener('pointerenter', enter, { passive: true });
    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', reset);
    el.addEventListener('pointercancel', reset);
    el.addEventListener('pointerup', reset);
    media.addEventListener('change', reset);
    return () => {
      if (sweepFrame) cancelAnimationFrame(sweepFrame);
      reset();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', reset);
      el.removeEventListener('pointercancel', reset);
      el.removeEventListener('pointerup', reset);
      media.removeEventListener('change', reset);
    };
  }, [
    visualCard,
    card?.id,
    card?.heroId,
    identity.treatment,
    identity.family,
    identity.motif,
    surface,
    selected,
    interactive,
  ]);
  return ref;
}
