import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ChampionDeckSummary} from '../src/game';
import {PvpLobby,lobbyDeckId} from '../src/presentation/pvp/PvpLobby';
vi.mock('../src/presentation/mastery/masteryApi', async importOriginal => ({...await importOriginal<typeof import('../src/presentation/mastery/masteryApi')>(), useMastery:()=>({state:null,error:''})}));
const decks:ChampionDeckSummary[]=[{deckId:'main',championId:'mage',name:'Mazo principal',cardCount:30,maxCards:30,valid:true,isDefault:true},{deckId:'alt',championId:'mage',name:'Otro mazo',cardCount:30,maxCards:30,valid:true,isDefault:false}];
function lobby(mobile:boolean,ranked:boolean,valid=true,locked=false){return renderToStaticMarkup(createElement(PvpLobby,{mobile,room:null,hero:'mage',decks:decks.map(d=>({...d,valid})),deckId:'main',onCards(){},loadoutLocked:locked,mode:'DUEL',mapId:'classic',code:'',busy:false,network:'',error:'',onHero(){},onMode(){},onMap(){},onCode(){},onAction(){},onExit(){},queueKind:ranked?'RANKED':'CASUAL',onQueueKind(){},rankedSlot:ranked?createElement('div',null,'Datos Ranked'):undefined}));}
describe('Cards is the only owner of lobby deck selection',()=>{
 it('follows the current active deck instead of remembering a lobby override',()=>{expect(lobbyDeckId(decks)).toBe('main');const updated=decks.map(d=>({...d,isDefault:d.deckId==='alt'}));expect(lobbyDeckId(updated)).toBe('alt');expect(lobbyDeckId(JSON.parse(JSON.stringify(updated)))).toBe('alt');});
 it('preserves the server room deck even if the profile changes',()=>{expect(lobbyDeckId(decks,'alt','main')).toBe('alt');});
 it('preserves the queued deck until leaving the queue',()=>{const updated=decks.map(d=>({...d,isDefault:d.deckId==='alt'}));expect(lobbyDeckId(updated,undefined,'main')).toBe('main');expect(lobbyDeckId(updated)).toBe('alt');});
 it('does not silently choose another valid deck when no active deck exists',()=>{expect(lobbyDeckId(decks.map(d=>({...d,isDefault:false})))).toBeUndefined();});
 it.each([[false,false],[false,true],[true,false],[true,true]])('renders only a read-only summary in mobile=%s ranked=%s',(mobile,ranked)=>{const h=lobby(mobile,ranked);expect(h).toContain('Mazo activo: Mazo principal · 30/30');expect(h).not.toContain('<select');expect(h).not.toContain('<option');expect(h).not.toContain('Editar mazo');});
 it('keeps Casual creation blocked and offers Cards for an invalid deck',()=>{const h=lobby(false,false,false);expect(h).toContain('Configurar en Cartas');expect(h).toContain('El mazo activo no es válido para este campeón');expect(h).toMatch(/<button class="lobby-primary" disabled=""/);});
 it('does not allow navigating to deck setup during a locked loadout',()=>{expect(lobby(true,true,false,true)).toMatch(/<button[^>]*disabled=""[^>]*>Configurar en Cartas/);});
});
