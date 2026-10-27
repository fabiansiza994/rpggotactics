import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RitualEchoDialog } from '../src/presentation/react/components/RitualEchoDialog';

// Server rendering reads zustand's initial snapshot: stand in for the store with plain selectors.
const store = { selectedCardUid: null as string | null, playbackBusy: false, introLocked: false, confirmSummonSearch: () => {}, cancelAim: () => {} };
vi.mock('../src/presentation/store/battleStore', () => ({ useBattleStore: (sel: (s: typeof store) => unknown) => sel(store) }));
import { makeEngine, mutable, p, setHand } from './helpers';

/** Eco del Altar selector (functional UI): lists ONLY the legal ritual pieces of the own discard. */
describe('Eco del Altar selector UI', () => {
  it('shows "ELIGE UNA PIEZA DE RITUAL" with name, art, piece/ritual info for legal pieces only', () => {
    const e = makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) }] });
    mutable(e).player.energy = 4;
    mutable(e).player.discard = [{ uid: 'p1', cardId: 'mark_moon' }, { uid: 'f', cardId: 'summon_fox' }, { uid: 'p2', cardId: 'rune_stone' }];
    const [uid] = setHand(e, ['altar_echo']);
    store.selectedCardUid = uid!;
    const html = renderToStaticMarkup(createElement(RitualEchoDialog, { state: e.state, engine: e }));
    expect(html).toContain('ELIGE UNA PIEZA DE RITUAL');
    expect(html).toContain('data-choice-uid="p1"');
    expect(html).toContain('data-choice-uid="p2"');
    expect(html).not.toContain('data-choice-uid="f"');
    expect(html).toContain('Marca de la Luna');
    expect(html).toContain('Pieza de ritual · Ritual del Lobo Ancestral');
    expect(html).toContain('Recuperar pieza');
    expect(html).toContain('Cancelar');
  });

  it('renders no choices for a card that is not Eco del Altar', () => {
    const e = makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) } });
    mutable(e).player.discard = [{ uid: 'p1', cardId: 'mark_moon' }];
    const [uid] = setHand(e, ['summoner_ward']);
    store.selectedCardUid = uid!;
    expect(renderToStaticMarkup(createElement(RitualEchoDialog, { state: e.state, engine: e }))).not.toContain('data-choice-uid');
  });
});
