import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CONTENT } from '../src/game';
import { cardTypePalette } from '../src/presentation/cards/cardType';
import { cardRarityFinish } from '../src/presentation/cards/premiumTreatment';
import { CardPremiumFx } from '../src/presentation/react/components/CardPremiumFx';
import { CardTypeVisual } from '../src/presentation/react/components/CardTypeVisual';

describe('type header and additive rarity finish',()=>{
  const card=DEFAULT_CONTENT.cards.fireball!;
  it('preserves type when rarity or treatment changes',()=>{
    for(const rarity of ['COMMON','UNCOMMON','RARE'] as const){
      expect(cardTypePalette({...card,rarity})).toBe('attack');
    }
    expect(cardTypePalette({...card,heroId:undefined})).toBe('neutral');
  });
  it('maps existing visual metadata without inventing gameplay rarities',()=>{
    expect(cardRarityFinish({...card,rarity:'COMMON'})).toBe('common');
    expect(cardRarityFinish({...card,rarity:'UNCOMMON'})).toBe('common');
    expect(cardRarityFinish({...card,rarity:'RARE'})).toBe('rare');
    expect(cardRarityFinish({...card,presentation:{...card.presentation,premiumTreatment:'showcase'}})).toBe('secret');
    // Free catalog: super/ultra follow the LEGENDARY/ULTRA rarities; a Rare drop keeps the Rare finish.
    expect(cardRarityFinish(DEFAULT_CONTENT.cards.summon_war_drake!)).toBe('rare');
    expect(cardRarityFinish({...card,rarity:'LEGENDARY'})).toBe('super');
    expect(cardRarityFinish({...card,rarity:'ULTRA'})).toBe('ultra');
  });
  it('common and rare art have no foil overlay',()=>{
    for(const rarity of ['COMMON','RARE'] as const)
      expect(renderToStaticMarkup(createElement(CardPremiumFx,{def:{...card,rarity}}))).toBe('');
  });
  it('publishes both dimensions and leaves card definitions unchanged',()=>{
    const before=JSON.stringify(card);
    const html=renderToStaticMarkup(createElement(CardTypeVisual,{card}));
    expect(html).toContain('data-type-palette="attack"');
    expect(html).toContain('data-rarity-finish=');
    expect(JSON.stringify(card)).toBe(before);
  });
});
