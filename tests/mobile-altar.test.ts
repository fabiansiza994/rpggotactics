import {afterEach,describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AltarPanel} from '../src/presentation/react/components/Hud';
import {useBattleStore} from '../src/presentation/store/battleStore';
import {DEFAULT_CONTENT,withPrototypeRituals,ritualSelection} from '../src/game';
import {makeEngine,mutable,p} from './helpers';
const initial=useBattleStore.getState();
afterEach(()=>useBattleStore.setState(initial,true));
function setup(count=4){
 const engine=makeEngine({hero:{heroId:'summoner',pos:p(2,2)}},withPrototypeRituals(DEFAULT_CONTENT));
 mutable(engine).player.altar=['seal_claw','seal_fang','seal_wing','seal_heart'].slice(0,count).map((cardId,i)=>({uid:'sealed-'+i,cardId}));
 useBattleStore.setState({engine,state:engine.state,selectedCardUid:null,playbackBusy:false,introLocked:false});
 return engine;
}
const html=(engine:ReturnType<typeof setup>)=>renderToStaticMarkup(createElement(AltarPanel,{engine,state:engine.state,busy:false}));
describe('mobile altar presentation and unchanged targeting',()=>{
 it.each([0,1,4])('has explicit accessible close control with %i seals',count=>{const engine=setup(count);expect(html(engine)).toContain('aria-label="Cerrar altar"');});
 it('uses real ritual selection to expose cancellation, without a combat command',()=>{
  const engine=setup();const id=engine.getRitualProgress().find(p=>p.complete)!.ritual.id;
  const before=JSON.stringify(engine.state);useBattleStore.getState().selectCard(ritualSelection(id));
  expect(useBattleStore.getState().selectedCardUid).toBe(ritualSelection(id));
  expect(engine.getValidTargets(ritualSelection(id)).length).toBeGreaterThan(0);expect(JSON.stringify(engine.state)).toBe(before);
  useBattleStore.getState().selectCard(null);expect(html(engine)).not.toContain('data-targeting="true"');expect(JSON.stringify(engine.state)).toBe(before);
 });
 it('does not mistake an ordinary card for ritual targeting',()=>{const engine=setup();useBattleStore.setState({selectedCardUid:engine.state.player.hand[0]?.uid??null});expect(html(engine)).not.toContain('Cancelar ritual');});
});
