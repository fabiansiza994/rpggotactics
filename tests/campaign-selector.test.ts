import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {CampaignChampionSelector,campaignProgressLabel} from '../src/presentation/react/components/CampaignChampionSelector';
import {readFileSync} from 'node:fs';
describe('scalable campaign champion selector',()=>{
 it('renders 20 catalog entries, independent progress, selection and unavailable reasons',()=>{
  const entries=Array.from({length:20},(_,i)=>({id:`hero-${i}`,name:`Hero ${i}`,portrait:'/portrait.webp',completed:i%11,total:10,...(i===19?{reason:'No disponible'}:{})}));
  const html=renderToStaticMarkup(createElement(CampaignChampionSelector,{entries,selectedId:'hero-3',actName:'Acto I',onClose:()=>{},onSelect:()=>{}}));
  expect(html.match(/class="campaign-champion-option"/g)).toHaveLength(20);expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);expect(html).toContain('3/10');expect(html).toContain('10/10 · Completado');expect(html).toContain('disabled=""');expect(html).toContain('No disponible');
 });
 it('formats new, active and completed progress without sharing champion state',()=>{
  expect(campaignProgressLabel(0,10)).toBe('Sin empezar');expect(campaignProgressLabel(8,10)).toBe('8/10');expect(campaignProgressLabel(10,10)).toBe('10/10 · Completado');
 });
 it('keeps story selection fixed and derives main-act choices from existing availability and compatibility',()=>{
  const source=readFileSync('src/presentation/react/screens/MainMenu.tsx','utf8');
  expect(source).not.toContain('campaign-heroes');expect(source).toContain('heroChoices.filter(id=>supportsHero(shownCampaign,id))');expect(source).toContain("selectorOpen&&activeKind==='MAIN_ACT'");expect(source).toContain('HISTORIA DE CAMPEÓN');expect(source).toContain('selectCampaignHero(id)');
 });
});
