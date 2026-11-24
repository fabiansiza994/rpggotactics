import { presentationBus } from '../events/presentationBus';

/** Presentation-only feedback from accepted CARD_PLAYED facts. No optimistic casts or timers
 * that dispatch gameplay. The same bus receives authoritative PvP confirmations. */
export function attachCardActivation(footer: HTMLElement, heroId: () => string): () => void {
  const active = new Map<string, () => void>();
  // Accepted snapshots may remove the two cards before the presentation bus runs.
  // Cache their current visual state at the response gesture; this never plays optimistically.
  const responseCards = new Map<string, { node: HTMLElement; rect: DOMRect }>();
  const rememberResponse = () => {
    if (!footer.querySelector('.hand.is-silence-response')) return;
    responseCards.clear();
    for (const card of footer.querySelectorAll<HTMLElement>('.hand .card[data-card-uid]')) {
      responseCards.set(card.dataset.cardUid!, {node:card.cloneNode(true) as HTMLElement,rect:card.getBoundingClientRect()});
    }
  };
  footer.addEventListener('pointerdown',rememberResponse,true);
  footer.addEventListener('keydown',rememberResponse,true);
  const off = presentationBus.subscribe((events, state) => {
    const negation = events.some(e => e.type === 'CARD_NEGATED' && e.responderId === heroId());
    const cards = new Set(events.flatMap(e => e.type === 'CARD_PLAYED' && e.casterId === heroId() ? [e.cardUid] : []));
    // Private discard events are intentionally filtered by PvP. Derive only our own confirmed
    // hand→grave transitions from the authoritative snapshot, without publishing new events.
    if (negation) for (const uid of responseCards.keys()) {
      if (state.player.discard.some(c => c.uid === uid) && !state.player.hand.some(c => c.uid === uid)) cards.add(uid);
    }
    for (const cardUid of cards) {
      if (active.has(cardUid)) continue;
      const card = [...footer.querySelectorAll<HTMLElement>('.hand .card[data-card-uid]')].find(
        (el) => el.dataset.cardUid === cardUid,
      );
      const saved = negation ? responseCards.get(cardUid) : undefined;
      const discard = footer.querySelector<HTMLElement>('.pile-discard') ?? (negation ? footer.closest('.battle')?.querySelector<HTMLElement>('.battle-pile-bank.is-own .battle-pile-grave') : null);
      if ((!card && !saved) || !discard) continue;
      const source = card ?? saved!.node;
      const from = card?.getBoundingClientRect() ?? saved!.rect,
        to = discard.getBoundingClientRect();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const layer = document.createElement('div');
      layer.className = `hand card-activation-layer${reduced ? ' is-reduced' : ''}`;
      layer.dataset.castKind = source.dataset.ritualPiece
        ? 'ritual'
        : source.dataset.family === 'summon'
          ? 'summon'
          : 'spell';
      layer.dataset.state = 'casting';
      layer.dataset.activationUid = cardUid;
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
      const ghost = source.cloneNode(true) as HTMLElement;
      ghost.classList.add('is-selected', 'card-activation');
      ghost.dataset.state = 'casting';
      ghost.removeAttribute('data-card-uid');
      ghost.removeAttribute('data-silence-role');
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
        active.delete(cardUid);
      };
      layer.addEventListener('animationend', (e) => {
        if (e.target === layer) remove();
      });
      // Also clean up if animation events are suppressed (hidden tab, disabled animations).
      const timer = setTimeout(remove, reduced ? 240 : 460);
      active.set(cardUid, remove);
      footer.appendChild(layer);
    }
    if (!state.responseWindow) responseCards.clear();
  });
  return () => {
    off();
    footer.removeEventListener('pointerdown',rememberResponse,true);
    footer.removeEventListener('keydown',rememberResponse,true);
    responseCards.clear();
    for (const remove of [...active.values()]) remove();
  };
}
