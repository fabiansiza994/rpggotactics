import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RANKED_PREMIUM_CARDS } from '../src/game/data/ranked-premium-cards';
import { RANKED_PREMIUM_TRACK, rankedPremiumView } from '../src/game/ranked/premiumTrack';
import { RANKED_PREMIUM_SHOWCASES } from '../src/game/ranked/premiumCosmetics';
import { RANKED_PREMIUM_AVATARS, profileAvatar } from '../src/shared/profileAvatars';
import { FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';
import { PREMIUM_REWARD_ART, premiumArt, premiumThumbnail } from '../src/presentation/ranked/premiumPresentation';
import { PremiumDetail, PremiumRewardArt } from '../src/presentation/ranked/RankedPremiumTrack';
import { ProfileFrame } from '../src/presentation/shop/ProfileFrame';
import { cosmeticCard } from '../src/presentation/cosmetics/cardCosmetics';
const cards = RANKED_PREMIUM_CARDS;
const inventory = [...cards.map(c => c.id), ...Object.keys(PREMIUM_REWARD_ART), ...Object.keys(RANKED_PREMIUM_SHOWCASES)];
describe('final Premium artwork wiring', () => {
  it('covers precisely 16 reward resources, with five Showcase aliases and eleven unique rasters', () => {
    expect(inventory).toHaveLength(16);
    expect(new Set(inventory).size).toBe(16);
    const paths=[...cards.map(c=>FINAL_CARD_ART[c.id]!),...Object.values(PREMIUM_REWARD_ART)];
    expect(new Set(paths).size).toBe(11);
    for(const path of paths){
      const file=new URL('../public'+path,import.meta.url), bytes=readFileSync(file);
      expect(bytes.toString('ascii',0,4)).toBe('RIFF');
      expect(bytes.toString('ascii',8,12)).toBe('WEBP');
      expect(statSync(file).size).toBeLessThan(300_000);
    }
  });
  it.each(cards)('keeps $id Showcase identity and reuses its final illustration', card => {
    const id='showcase_'+card.id;
    const cosmetic=cosmeticCard(card,{owned:[{cosmeticId:id,kind:'CARD_ART',acquiredAt:1}],equipped:{CARD_ART:id}});
    expect(cosmetic.id).toBe(card.id); expect(cosmetic.effects).toEqual(card.effects);
    expect(cosmetic.cost).toBe(card.cost);expect(cosmetic.rarity).toBe(card.rarity);
    expect(cosmetic.presentation.premiumTreatment).toBe('showcase');
    expect(FINAL_CARD_ART[cosmetic.id]).toBe(`/art/ranked-premium/${card.id}.webp`);
  });
  it('uses controlled, smaller thumbnails only in compact nodes',()=>{
    const view=rankedPremiumView({rp:0,peakRp:0,pass:null,granted:{},showcase:null});
    for(const item of view.nodes.flatMap(n=>n.items).filter(i=>i.type==='CARD')){
      const thumb=premiumThumbnail(item)!;
      expect(thumb).toContain('-thumb.webp');
      expect(statSync(new URL('../public'+thumb,import.meta.url)).size).toBeLessThan(15_000);
      expect(renderToStaticMarkup(createElement(PremiumRewardArt,{item,compact:true}))).toContain(thumb);
      expect(renderToStaticMarkup(createElement(PremiumRewardArt,{item}))).toContain(premiumArt(item));
    }
  });
  it('resolves earned avatar ids to their final WebP while retaining their ownership requirement', () => {
    expect(RANKED_PREMIUM_AVATARS).toHaveLength(3);
    for(const a of RANKED_PREMIUM_AVATARS){expect(a.unlockType).toBe('OWNED');expect(profileAvatar(a.id).asset).toBe(PREMIUM_REWARD_ART[a.id]);}
  });
  it.each(['frame_premium_circle_bronze','frame_premium_threshold_crown'])('renders %s as a transparent circular overlay around the existing portrait',id=>{
    const html=renderToStaticMarkup(createElement(ProfileFrame,{frameId:id,children:createElement('img',{src:'/portrait.webp',alt:'QA'})}));
    expect(html).toContain(PREMIUM_REWARD_ART[id]);expect(html).toContain('<circle');expect(html).toContain('portrait.webp');
  });
  it('keeps all eighteen rewards, final art demand-loaded and canonical rules untouched',()=>{
    const view=rankedPremiumView({rp:1700,peakRp:1700,pass:{purchasedAt:1},granted:{},showcase:null});
    expect(view.nodes).toHaveLength(18);expect(RANKED_PREMIUM_TRACK).toHaveLength(18);
    for(const node of view.nodes){for(const item of node.items){
      const html=renderToStaticMarkup(createElement(PremiumRewardArt,{item}));
      expect(html).not.toContain('ARTE PENDIENTE');
      if(!['TITLE','CRYSTALS'].includes(item.type)){expect(premiumArt(item)).toBeTruthy();expect(html).toContain('loading="lazy"');}
    }
    const html=renderToStaticMarkup(createElement(PremiumDetail,{node,view,onChange:()=>{},onRefresh:()=>{}}));
    expect(html).not.toContain('arte esté disponible');expect(html).not.toContain('combate está pendiente');
    }
  });
});
