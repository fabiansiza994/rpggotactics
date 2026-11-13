import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PvpTurnSummary } from '../src/presentation/pvp/PvpTurnSummary';
import { AltarPanel } from '../src/presentation/react/components/Hud';
import { DEFAULT_CONTENT as BASE_CONTENT, GameEngine, createProfile } from '../src/game';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
const DEFAULT_CONTENT=withShapeshifterRelease(BASE_CONTENT);
import { createDuel, duelView, validateLoadout, DUEL_SCENARIO } from '../src/game/pvp/duel';

function altar(local: string, rival: string, seat: 0 | 1) {
 const p=createProfile(DEFAULT_CONTENT);
 const def=DEFAULT_CONTENT.heroes[local]!;

 const load=(id:string)=>validateLoadout(p,id,DEFAULT_CONTENT);
 const state=createDuel(seat===0?[load(local),load(rival)]:[load(rival),load(local)],7,'DUEL','classic',DEFAULT_CONTENT);
 const view=JSON.parse(JSON.stringify(duelView(state,seat)));
 const engine=GameEngine.fromSnapshot(view,DEFAULT_CONTENT,DUEL_SCENARIO);
 expect(view.units.find((u:{id:string})=>u.id===view.player.heroId).defId).toBe(def.id);
 if(local!=='summoner') expect(engine.getAltarStatus()).toBeNull();
 return renderToStaticMarkup(createElement(AltarPanel,{state:view,engine,busy:false}));
}
describe('local altar isolation',()=>{
 it.each([0,1] as const)('summoner seat %s owns its functional altar',seat=>{
  const html=altar('summoner','mage',seat); expect(html).toContain('data-testid="altar-panel"'); expect(html).toContain('Piezas selladas');
 });
 it.each([0,1] as const)('mage seat %s never renders own ritual controls against summoner',seat=>expect(altar('mage','summoner',seat)).toBe(''));
 it.each([0,1] as const)('shapeshifter seat %s has no own altar against summoner',seat=>expect(altar('shapeshifter','summoner',seat)).toBe(''));
 it('changing champion and hydrating repeated snapshots never leaks own altar',()=>{
  for(const local of ['summoner','mage','shapeshifter','mage','summoner']) {
   const a=altar(local,'summoner',0),b=altar(local,'summoner',0);expect(a).toBe(b);expect(a.includes('altar-panel')).toBe(local==='summoner');
  }
 });
});
describe('PvP turn messages',()=>{
 it('keeps ranked badge/title/network in a single flow owner instead of sibling grid spans',()=>{
  const html=renderToStaticMarkup(createElement(PvpTurnSummary,{ranked:true,title:"Tu turno",round:2,network:"Conectado",seconds:30,validating:false}));
  expect(html).toContain('class="pvp-turn-summary"');expect(html).toContain('class="pvp-turn-meta"');expect(html).toContain('aria-live="polite"');expect(html).toContain('Clasificatoria');expect(html).toContain('Tu turno');expect(html).toContain('Conectado');
 });
 it('a recovered status no longer contains reconnect/validation text from previous renders',()=>{
  expect(renderToStaticMarkup(createElement(PvpTurnSummary,{ranked:true,title:"Resolviendo…",round:2,network:"Reconectando…",seconds:null,validating:true}))).toContain('Reconectando');
  const html=renderToStaticMarkup(createElement(PvpTurnSummary,{ranked:true,title:"Tu turno",round:2,network:"Conectado",seconds:null,validating:false}));
  expect(html).not.toContain('Reconectando');expect(html).not.toContain('Validando');expect(html).toContain('Conectado');
 });
});
