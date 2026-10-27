/** Presentation metadata only. Never consulted by damage, statuses or acquisition. */
export const SPECIAL_ARROW_VISUALS = {
  ice_arrow: { tone: '#9bddeb', color: 0x9bddeb, family: 'ICE', icon: 'frost', trail: 'frost' },
  fire_arrow: { tone: '#e5a06d', color: 0xe5a06d, family: 'FIRE', icon: 'flame', trail: 'ember' },
  poison_arrow: { tone: '#9bbd81', color: 0x9bbd81, family: 'ARCANE', icon: 'poison', trail: 'venom' },
  rebound_arrow: { tone: '#dec486', color: 0xdec486, family: 'FORCE', icon: 'rebound', trail: 'gold' },
  smoke_arrow: { tone: '#aaa0b7', color: 0xaaa0b7, family: 'FORCE', icon: 'smoke', trail: 'smoke' },
} as const;
export type SpecialArrowId = keyof typeof SPECIAL_ARROW_VISUALS;
export const specialArrow = (id: string) => SPECIAL_ARROW_VISUALS[id as SpecialArrowId];
export const isArrowVisual = (key: string) => key === 'archer_arrow' || !!specialArrow(key);
export const isVeilEncounter = (id: string) => id.startsWith('hunt_');
export function veilStage(id: string): 'trail' | 'ruins' | 'veil' | 'boss' {
  const n = Number(id.split('_')[1]);
  return n === 10 ? 'boss' : n >= 7 ? 'veil' : n >= 4 ? 'ruins' : 'trail';
}
