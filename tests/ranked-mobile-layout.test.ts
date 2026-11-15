import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RankedPanel} from '../src/presentation/ranked/RankedViews';
import type {RankedQueueState} from '../src/presentation/ranked/rankedApi';
const profile={enabled:true as const,rp:46,wins:14,losses:10,draws:0,milestones:[],queue:{state:'IDLE' as const}};
function panel(queue:RankedQueueState, mobile=true, busy=false, blocked:string|null=null){return renderToStaticMarkup(createElement(RankedPanel,{mobile,profile,queue,busy,blocked,error:'',championName:'Guerrero',onSearch(){},onCancel(){}}));}
describe('single existing Ranked action across mobile lobby states',()=>{
 it('renders one search action and no cancellation while idle',()=>{const h=panel({state:'IDLE'});expect((h.match(/>Buscar partida</g)||[])).toHaveLength(1);expect(h).not.toContain('Cancelar búsqueda');});
 it('replaces search with one cancel action while searching',()=>{const h=panel({state:'SEARCHING',heroId:'warrior',since:Date.now()});expect((h.match(/>Cancelar búsqueda</g)||[])).toHaveLength(1);expect(h).not.toContain('>Buscar partida<');});
 it('does not allow another action while matched',()=>{const h=panel({state:'MATCHED',code:'QA'});expect(h).toContain('Rival encontrado');expect(h).not.toContain('>Buscar partida<');expect(h).not.toContain('Cancelar búsqueda');});
 it.each([[true,null],[false,'Mazo inválido']])('preserves authoritative busy/eligibility disabling (%s,%s)',(busy,blocked)=>{expect(panel({state:'IDLE'},true,busy,blocked)).toMatch(/<button[^>]*disabled=""[^>]*>Buscar partida/);});
 it('keeps exactly one desktop queue action with no mobile rewards carousel',()=>{const h=panel({state:'IDLE'},false);expect((h.match(/>Buscar partida</g)||[])).toHaveLength(1);expect(h).not.toContain('r21-reward-strip');});
});
