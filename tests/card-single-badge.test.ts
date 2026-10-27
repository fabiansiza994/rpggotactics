import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CONTENT } from '../src/game';
import { CardView } from '../src/presentation/react/components/CardView';
import { CardTypeVisual } from '../src/presentation/react/components/CardTypeVisual';

/** Prevent a second badge returning through decorative type/selection layers. */
describe('one top-right badge in the base card',()=>{
 for(const id of ['guard','bastion_blow','summon_pact_golem','seal_claw']) {
  it.each([false,true])(`${id} selected=%s retains a single badge`,selected=>{
   const def=DEFAULT_CONTENT.cards[id]!;expect(def).toBeDefined();
   const html=renderToStaticMarkup(createElement(CardView,{def,hotkey:1,selected,playable:true,onClick:()=>{},onCancel:()=>{}}));
   expect(html.match(/class="card-class-icon"/g)).toHaveLength(1);
   expect(html).not.toContain('class="card-type-icon"');
   expect(html).toContain('class="card-type-visual"'); // palette/rarity metadata preserved
   expect(html.includes('class="card-selection-cancel"')).toBe(selected);
  });
 }
 it('other art-header consumers still get their existing icon by default',()=>{
  const html=renderToStaticMarkup(createElement(CardTypeVisual,{card:DEFAULT_CONTENT.cards.fireball!}));
  expect(html.match(/class="card-type-icon"/g)).toHaveLength(1);
 });
});
