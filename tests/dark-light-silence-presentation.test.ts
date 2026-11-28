vi.mock('../src/presentation/audio/BattleAudioScene',()=>({BattleAudioScene:()=>null}));
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {silenceChoices} from '../src/presentation/react/components/SilenceResponseDialog';
import {HandBar} from '../src/presentation/react/components/Hud';
import {useBattleStore} from '../src/presentation/store/battleStore';
import {GameEngine,createProfile} from '../src/game';
import {createDuel,duelView,validateLoadout,DUEL_SCENARIO} from '../src/game/pvp/duel';
import {PVP_CONTENT} from '../server/src/pvp';
function fixture(){const p=createProfile(PVP_CONTENT),load=validateLoadout(p,'mage',PVP_CONTENT),s=createDuel([load,load],47,'DUEL','classic',PVP_CONTENT);s.player.hand=[{uid:'seal',cardId:'dark_silence_seal'},{uid:'seal2',cardId:'dark_silence_seal'},{uid:'cost',cardId:'fireball'}];s.player.energy=4;const view=duelView(s,s.duel!.active,PVP_CONTENT);view.phase='ENEMY';view.responseWindow={id:'window',cardId:'barrier',casterId:s.duel!.other.heroId,respondingHeroId:view.player.heroId,deadline:Date.now()+5000};const engine=GameEngine.fromSnapshot(view,PVP_CONTENT,DUEL_SCENARIO);return{view,engine}}
it('renders response candidates directly in the real hand, with no form/dialog/select or automatic discard',()=>{
 const{view,engine}=fixture();useBattleStore.setState({state:view,engine,introLocked:false,playbackBusy:true});
 const html=renderToStaticMarkup(createElement(HandBar,{state:view,engine}));
 expect(html).not.toContain('<select');expect(html).not.toContain('class="silence-response"');expect(html).not.toContain('Respuesta ·');
 expect(html).toContain('data-silence-role="chosen"');expect(html).toContain('data-silence-role="seal"');expect(html).toContain('data-silence-role="muted"');
 expect(html).toContain('Seleccionar esta copia de Sello');expect(html).not.toContain('data-silence-role="discard"');
});
it('uses the same executable-response query without mutating state or revealing a hidden curse',()=>{const{view,engine}=fixture();view.player.hand[0]!.twistedCurse=true;const before=JSON.stringify(view);expect(silenceChoices(view,engine).map(c=>c.uid)).toEqual(['seal','seal2']);expect(JSON.stringify(view)).toBe(before);view.player.energy=0;expect(silenceChoices(view,engine)).toEqual([])});
it('allows neutral Seals for other champions while preserving unavailable-copy and discard requirements',()=>{const{view,engine}=fixture();const hero=view.units.find(u=>u.id===view.player.heroId)!;hero.defId='summoner';expect(silenceChoices(view,engine).map(c=>c.uid)).toEqual(['seal','seal2']);Object.assign(view.player.hand[1]!,{traded:true,controllerId:hero.id});expect(silenceChoices(view,engine).map(c=>c.uid)).toEqual(['seal','seal2']);view.player.hand[1]!.unavailableThisTurn=true;expect(silenceChoices(view,engine).map(c=>c.uid)).toEqual(['seal']);view.player.hand=view.player.hand.slice(0,1);hero.defId='mage';expect(silenceChoices(view,engine)).toEqual([])});
it('cleans hand response presentation on expiry and when there is no authoritative window',()=>{const{view,engine}=fixture();view.responseWindow!.deadline=0;useBattleStore.setState({state:view,engine,introLocked:false});let html=renderToStaticMarkup(createElement(HandBar,{state:view,engine}));expect(html).not.toContain('data-silence-role=');delete view.responseWindow;html=renderToStaticMarkup(createElement(HandBar,{state:view,engine}));expect(html).not.toContain('data-silence-role=');expect(html).not.toContain('silence-context-caption')});

it('renders the authoritative announced variant, paid cost and public target with a fifteen-second timer',()=>{
 const {view,engine}=fixture();
 const card={...PVP_CONTENT.cards.magic_missile!,name:'Variante anunciada por el motor',rulesText:'Efecto público completo de la variante'};
 view.responseWindow={...view.responseWindow!,deadline:Date.now()+15000,durationMs:15000,announcement:{card,paidEnergy:1,target:{x:3,y:2}}};
 useBattleStore.setState({state:view,engine,introLocked:false,playbackBusy:true});
 const html=renderToStaticMarkup(createElement(HandBar,{state:view,engine}));
 expect(html).toContain('Variante anunciada por el motor');
 expect(html).toContain('15 s');expect(html).toContain('Efecto público completo de la variante');
 expect(html).toContain('Negar con Sello');expect(html).toContain('Dejar resolver');
 expect(html).toContain('Objetivo: casilla');
 expect(html).not.toContain('searchUid');
});
