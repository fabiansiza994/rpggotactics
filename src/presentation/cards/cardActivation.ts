import { presentationBus } from '../events/presentationBus';

/** Presentation-only feedback from accepted CARD_PLAYED facts. No optimistic casts or timers
 * that dispatch gameplay. The same bus receives authoritative PvP confirmations. */
export function attachCardActivation(footer: HTMLElement, heroId: () => string): () => void {
  const active = new Map<string, () => void>();
  const off = presentationBus.subscribe((events) => {
    for (const event of events) {
      if (event.type !== 'CARD_PLAYED' || event.casterId !== heroId() || active.has(event.cardUid))
        continue;
      const card = [...footer.querySelectorAll<HTMLElement>('.hand .card[data-card-uid]')].find(
        (el) => el.dataset.cardUid === event.cardUid,
      );
      const discard = footer.querySelector<HTMLElement>('.pile-discard');
      if (!card || !discard) continue;
      const from = card.getBoundingClientRect(),
        to = discard.getBoundingClientRect();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const layer = document.createElement('div');
      layer.className = `hand card-activation-layer${reduced ? ' is-reduced' : ''}`;
      layer.dataset.castKind = card.dataset.ritualPiece
        ? 'ritual'
        : card.dataset.family === 'summon'
          ? 'summon'
          : 'spell';
      layer.dataset.state = 'casting';
      layer.dataset.activationUid = event.cardUid;
      layer.setAttribute('aria-hidden', 'true');
      layer.setAttribute('inert', '');
      Object.assign(layer.style, {
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
      });
      layer.style.setProperty(
        '--cast-x',
        `${to.left + to.width / 2 - from.left - from.width / 2}px`,
      );
      layer.style.setProperty(
        '--cast-y',
        `${to.top + to.height / 2 - from.top - from.height / 2}px`,
      );
      const ghost = card.cloneNode(true) as HTMLElement;
      ghost.classList.add('is-selected', 'card-activation');
      ghost.dataset.state = 'casting';
      ghost.removeAttribute('data-card-uid');
      ghost.removeAttribute('aria-label');
      ghost.removeAttribute('aria-pressed');
      ghost.tabIndex = -1;
      for (const name of ['flash', 'ring', 'rune']) {
        const effect = document.createElement('span');
        effect.className = `card-cast-${name}`;
        effect.setAttribute('aria-hidden', 'true');
        if (name === 'rune') effect.textContent = '✧';
        ghost.appendChild(effect);
      }
      layer.appendChild(ghost);
      const remove = () => {
        clearTimeout(timer);
        layer.remove();
        active.delete(event.cardUid);
      };
      layer.addEventListener('animationend', (e) => {
        if (e.target === layer) remove();
      });
      // Also clean up if animation events are suppressed (hidden tab, disabled animations).
      const timer = setTimeout(remove, reduced ? 240 : 460);
      active.set(event.cardUid, remove);
      footer.appendChild(layer);
    }
  });
  return () => {
    off();
    for (const remove of [...active.values()]) remove();
  };
}
