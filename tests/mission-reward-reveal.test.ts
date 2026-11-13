import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialReveal, rewardRevealReducer as reduce, revealBusy } from '../src/presentation/cards/rewardRevealState';
import { MissionRewardChoice } from '../src/presentation/react/components/MissionRewardChoice';

describe('mission reward presentation state (no grants)', () => {
  it('starts hidden and reveals without selecting', () => {
    const s = reduce(initialReveal(['a','b','c']),{type:'reveal',id:'a'});
    expect(s.faces).toEqual({a:'revealing',b:'hidden',c:'hidden'});
    expect(s.picked).toBeNull(); expect(revealBusy(s)).toBe(true);
    expect(reduce(s,{type:'reveal',id:'a'})).toBe(s);
    expect(reduce(s,{type:'select',id:'a'})).toBe(s);
    expect(reduce(s,{type:'confirm'})).toBe(s);
  });
  it('can reveal all before choosing and deselect', () => {
    let s = initialReveal(['a','b','c']);
    for (const id of ['a','b','c']) { s=reduce(s,{type:'reveal',id}); s=reduce(s,{type:'finish',id}); }
    expect(s.picked).toBeNull(); expect(revealBusy(s)).toBe(false);
    s=reduce(s,{type:'select',id:'b'}); expect(s.picked).toBe('b');
    s=reduce(s,{type:'select',id:'b'}); expect(s.picked).toBeNull();
  });
  it('blocks save while another card flips and ignores repeated confirmation', () => {
    let s=initialReveal(['a','b']);
    s=reduce(reduce(s,{type:'reveal',id:'a'}),{type:'finish',id:'a'});
    s=reduce(s,{type:'select',id:'a'}); s=reduce(s,{type:'reveal',id:'b'});
    expect(reduce(s,{type:'confirm'})).toBe(s);
    s=reduce(s,{type:'finish',id:'b'}); s=reduce(s,{type:'confirm'});
    expect(s.confirming).toBe(true); expect(reduce(s,{type:'confirm'})).toBe(s);
    expect(reduce(s,{type:'select',id:'b'})).toBe(s);
    expect(reduce(s,{type:'retry'}).picked).toBe('a');
  });
  it('reload resets only the ephemeral reveal, rejects unknown options', () => {
    const s=initialReveal(['a']); expect(reduce(s,{type:'reveal',id:'forged'})).toBe(s);
    expect(initialReveal(['a']).faces.a).toBe('hidden');
  });
  it('renders real complete faces with equipped backs, initially inaccessible and save disabled', () => {
    const html=renderToStaticMarkup(createElement(MissionRewardChoice,{ options:[{id:'a',kind:'ADD_CARD',cardId:'magic_missile',rarity:'COMMON',isNew:true}],heroId:'mage',saving:false,onConfirm:()=>{},confirmLabel:'Guardar recompensa'}));
    expect(html).toContain('card-back-face'); expect(html).toContain('feature-card mission-reward-face');
    expect(html).toContain('data-phase="hidden"'); expect(html).toContain('Revelar recompensa 1');
    expect(html).toMatch(/disabled=""[^>]*>Guardar recompensa/);
  });
  it('keeps inspection locked until reveal and preserves one confirmation outside the scrollable choices', () => {
    const html=renderToStaticMarkup(createElement(MissionRewardChoice,{options:[{id:'card',kind:'ADD_CARD',cardId:'magic_missile',rarity:'COMMON',isNew:true},{id:'hp',kind:'MAX_HP',amount:2}],heroId:'mage',saving:false,onConfirm:()=>{},confirmLabel:'Guardar recompensa'}));
    expect(html).toContain('aria-label="Opciones de recompensa; desplázate para ver todas"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Inspeccionar Magic Missile"/);
    expect(html.match(/class="reward-confirm"/g)).toHaveLength(1);
    expect(html).not.toContain('Inspeccionar Vida máxima');
    expect(html).not.toContain('<dialog');
  });

});
