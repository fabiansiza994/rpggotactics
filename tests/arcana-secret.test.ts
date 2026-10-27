import { describe,it,expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CONTENT } from '../src/game';
import { withArcanaSecret,cardRarityFinish } from '../src/presentation/cards/premiumTreatment';
import { CardFinishPreviewContext } from '../src/presentation/cosmetics/cardCosmetics';
import { CardPremiumFx } from '../src/presentation/react/components/CardPremiumFx';
describe('Arcana Secreta cosmetic presentation',()=>{
 const card=DEFAULT_CONTENT.cards.double_moon_pact!;
 it('preserves the official rarity, effects, costs and source definition',()=>{
  const before=JSON.stringify(card),visual=withArcanaSecret(card);
  expect(cardRarityFinish(visual)).toBe('arcana-secret');
  expect(visual.rarity).toBe(card.rarity);expect(visual.effects).toBe(card.effects);
  expect(JSON.stringify(card)).toBe(before);
 });
 it('does not convert Showcase or Ultra into Arcana Secreta',()=>{
  expect(cardRarityFinish({...card,presentation:{...card.presentation,premiumTreatment:'showcase'}})).toBe('secret');
  expect(cardRarityFinish({...card,rarity:'ULTRA'})).toBe('ultra');
 });
 it('renders the shared clipped art finish only for the chosen presentation card',()=>{
  const html=renderToStaticMarkup(createElement(CardFinishPreviewContext.Provider,{value:card.id},createElement(CardPremiumFx,{def:card})));
  expect(html).toContain('data-rarity-finish="arcana-secret"');
  expect(html.match(/class="cp-foil"/g)).toHaveLength(1);
  expect(renderToStaticMarkup(createElement(CardPremiumFx,{def:card}))).not.toContain('arcana-secret');
 });
});
