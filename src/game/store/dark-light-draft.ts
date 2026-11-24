import { DARK_LIGHT_CARDS, DARK_LIGHT_EXPANSIONS } from '../data/dark-light';
import { createBoxStock } from './boxes';
/** Historical export name retained for callers; product approval makes these local commercial boxes available. */
export const DARK_LIGHT_DRAFT_BOXES = [
  { id: DARK_LIGHT_EXPANSIONS.dark, name: 'Aliados de la Oscuridad', painting: '/art/dark-light/cards/dark_dark_world.jpg' },
  { id: DARK_LIGHT_EXPANSIONS.light, name: 'Camino hacia la Luz', painting: '/art/dark-light/cards/light_light_world.jpg' },
].map(set => {
  const cards = DARK_LIGHT_CARDS.filter(card => card.expansion === set.id);
  return { ...set, status: 'AVAILABLE' as const, saleEnabled: true as const, boostersEnabled: true as const, cards, initialStock: createBoxStock(cards) };
});
