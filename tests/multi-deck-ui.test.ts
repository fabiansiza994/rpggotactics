import {createElement as h} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createProfile, DEFAULT_CONTENT, heroProfile, createDeck, DECK_RULES, deckSummaries} from '../src/game';
import {useBattleStore} from '../src/presentation/store/battleStore';
import {MyDecks} from '../src/presentation/react/screens/MyDecks';
import {PvpLobby} from '../src/presentation/pvp/PvpLobby';
import {rankedApi} from '../src/presentation/ranked/rankedApi';
vi.mock('../src/presentation/store/battleStore', async importOriginal=>{
 const m=await importOriginal<typeof import('../src/presentation/store/battleStore')>();
 return {...m,useBattleStore:Object.assign((selector:(s:ReturnType<typeof m.useBattleStore.getState>)=>unknown)=>selector(m.useBattleStore.getState()),m.useBattleStore)};
});
vi.mock('../src/presentation/mastery/masteryApi',async importOriginal=>({...await importOriginal<typeof import('../src/presentation/mastery/masteryApi')>(),useMastery:()=>({state:null,error:null,refresh:()=>{}})}));
const initial=useBattleStore.getState();
afterEach(()=>{useBattleStore.setState(initial);vi.unstubAllGlobals();});
describe('multi-deck UI contracts',()=>{
 it('shows one deck with default, validity and no last-deck deletion',()=>{
  useBattleStore.setState({profile:createProfile(DEFAULT_CONTENT),deckHeroId:'mage'});
  const html=renderToStaticMarkup(h(MyDecks,{onEdit:()=>{}}));
  expect(html).toContain('Mis mazos');expect(html).toContain('Acciones de Mazo inicial');expect(html).toContain('md-cover-art');expect(html).toContain('md-empty-emblem');expect(html).toContain('Predeterminado');expect(html).toContain('Válido');expect(html).toMatch(/disabled=""[^>]*title="No puedes eliminar el último mazo"/);
 });
 it('keeps invalid decks visible and disables creation/duplication at three slots',()=>{
  let profile=createProfile(DEFAULT_CONTENT);
  for(let i=0;i<2;i++){const r=createDeck(profile,'mage',{},DEFAULT_CONTENT,DECK_RULES,100+i);if(!r.ok)throw Error(r.error);profile=r.profile;}
  const hero=heroProfile(profile,'mage',DEFAULT_CONTENT);hero.decks[1]!.cards=[];
  useBattleStore.setState({profile,deckHeroId:'mage'});
  const html=renderToStaticMarkup(h(MyDecks,{onEdit:()=>{}}));
  expect(html).toContain('Incompleto');expect(html).toContain('Máximo 3 mazos');expect(html).not.toContain('class="md-create"');expect(html.match(/class="md-primary"/g)).toHaveLength(3);
 });
 it('renders the selected invalid deck, blocks casual queue and locks ranked room selection',()=>{
  const profile=createProfile(DEFAULT_CONTENT);useBattleStore.setState({profile});
  const decks=deckSummaries(profile,'mage',DEFAULT_CONTENT,DECK_RULES).map(d=>({...d,valid:false}));
  const props={room:null,hero:'mage',mode:'DUEL' as const,mapId:'classic',code:'ABCDEFGH',busy:false,network:'Sin sala',error:'',onHero:()=>{},onMode:()=>{},onMap:()=>{},onCode:()=>{},onAction:()=>{},onExit:()=>{},decks,deckId:decks[0]!.deckId,onDeck:()=>{}};
  const html=renderToStaticMarkup(h(PvpLobby,props));expect(html).toContain('Mazo inválido');expect(html).toContain('aria-label="Mazo para PvP o Ranked"');
  const locked=renderToStaticMarkup(h(PvpLobby,{...props,loadoutLocked:true,queueKind:'RANKED',rankedSlot:h('p',null,'Clasificatoria')}));
  expect(locked).toMatch(/<select[^>]*disabled=""/);expect(locked).toContain('Mazo fijado');
 });
 it('sends champion + saved deck id to Ranked, never a card list',async()=>{
  vi.stubGlobal('window',{localStorage:{getItem:()=>JSON.stringify({token:'disposable-test',username:'QA'})}});
  const fetcher=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({queue:{state:'IDLE'}})});vi.stubGlobal('fetch',fetcher);
  await rankedApi.join('mage','alternate');
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({heroId:'mage',deckId:'alternate'});
 });
});

it('shows the neutral-cap warning and blocks local new battles without changing saved cards',async()=>{
 const profile=createProfile(DEFAULT_CONTENT);
 const hero=heroProfile(profile,'mage',DEFAULT_CONTENT);
 hero.decks[0]!.cards=[{cardId:'arcane_surge',count:1},{cardId:'first_aid',count:2},{cardId:'take_cover',count:2}];
 const before=structuredClone(hero.decks);
 useBattleStore.setState({profile,deckHeroId:'mage',campaignHeroId:'mage'});
 const html=renderToStaticMarkup(h(MyDecks,{onEdit:()=>{}}));
 expect(html).toContain('Excede el máximo de 4 cartas neutrales (5)');
 expect(html).toContain('Editar');
 expect(await useBattleStore.getState().startScenario('first_blood',42,'mage',hero.decks[0]!.id)).toBe(false);
 expect(await useBattleStore.getState().startRun(42)).toBe(false);
 expect(useBattleStore.getState().notice).toContain('máximo es 4');
 expect(useBattleStore.getState().profile.heroes.mage!.decks).toEqual(before);
});
