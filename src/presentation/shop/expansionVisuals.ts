/** Editorial presentation only. Never changes a pool, price, entitlement or receipt. */
export interface ExpansionVisual {
  cover: string;
  environment: string;
  accent: string;
  glow: string;
  sigil: string;
  atmosphere: 'arcane' | 'storm' | 'snow' | 'spirits' | 'embers' | 'leaves';
}
export const EXPANSION_VISUALS: Readonly<Record<string, ExpansionVisual>> = {
  origins_arcanos: {cover:'/art/checkpoint05/cards/arcane_burst.webp',environment:'/art/checkpoint05/environments/sanctuary.webp',accent:'#c49aff',glow:'#7240c8',sigil:'✧',atmosphere:'arcane'},
  // The published Storm Avatar is the expansion's thematic centerpiece, not Origins artwork.
  thunder_god: {cover:'/art/mage-thunder/storm_avatar.webp',environment:'/art/mage-thunder/storm_avatar.webp',accent:'#8cdaff',glow:'#345cc9',sigil:'ϟ',atmosphere:'storm'},
  antarctic_magic: {cover:'/art/antarctic-market/expansion_hero.jpg',environment:'/art/antarctic-market/expansion_hero.jpg',accent:'#a1f5ff',glow:'#267fbd',sigil:'❄',atmosphere:'snow'},
  pack_pact: {cover:'/art/summoner/wolf.webp',environment:'/art/checkpoint05/environments/sanctuary.webp',accent:'#d6a2ff',glow:'#7434bf',sigil:'✧',atmosphere:'spirits'},
  warrior_promise: {cover:'/art/store-cards/heavy_strike.webp',environment:'/art/infernal/forge-background.webp',accent:'#ffc37e',glow:'#8e352d',sigil:'⚔',atmosphere:'embers'},
  reserva_cazador: {cover:'/art/archer-cards/archer_shot.webp',environment:'/art/archer-hunt/veil_forest.webp',accent:'#b9dba2',glow:'#356648',sigil:'➶',atmosphere:'leaves'},
};
export function expansionVisual(id?: string, fallbackArt?: string): ExpansionVisual {
  if (id && Object.hasOwn(EXPANSION_VISUALS,id)) return EXPANSION_VISUALS[id]!;
  return {...EXPANSION_VISUALS.origins_arcanos!,...(fallbackArt?{cover:fallbackArt,environment:fallbackArt}:{})};
}
