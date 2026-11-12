/** Presentation only. Existing five cards never enter these compositions. */
export const THUNDER_ADDITION_IDS = ['fulminating_spear','voltaic_armor','lightning_step','storm_orb','conductive_mark','thunder_hammer','static_field','electric_frenzy','lightning_wall','storm_avatar'] as const;
export const isThunderAddition = (id: string | undefined): boolean => THUNDER_ADDITION_IDS.some(x=>x===id);
export const thunderAdditionStyle = (id: string | undefined) => ({
  fulminating_spear: 'spear', voltaic_armor: 'shield', lightning_step: 'step', storm_orb: 'orb',
  conductive_mark: 'mark', thunder_hammer: 'hammer', static_field: 'field', electric_frenzy: 'frenzy',
  lightning_wall: 'wall', storm_avatar: 'avatar',
} as Record<string,string>)[id??''] ?? 'field';
