import {describe,it,expect} from 'vitest';
import {makeEngine,setHand} from './helpers';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PVP_CONTENT} from '../server/src/pvp';
import {DECK_RULES,withHeroDeck,createProfile,validateDeck,saveActiveDeck,ownedFor,copyLimit,serializeProfile,parseProfileSave,GameEngine,type PlayerProfile,type DeckEntry} from '../src/game';
import {cardsForHero,neutralCount} from '../src/game/collection/deck-rules';
import {generateDeck} from '../src/game/collection/auto-deck';
import {validateLoadout,createDuel,duelView,DUEL_SCENARIO,applyDuel} from '../src/game/pvp/duel';
import {NeutralCounter} from '../src/presentation/react/components/CardOriginBadge';
import {silenceChoices} from '../src/presentation/react/components/SilenceResponseDialog';
import {handle} from '../server/src/index';
import {contentTransition} from '../server/src/contentTransition';
import {createPlayer,loadPlayer} from '../server/src/repo';
import {memoryD1,addAccount} from './support/d1';
import {legacyOwnershipView} from '../server/src/winterCampaign';
import {CONTENT_RELEASE,supportsRoomRelease,canRunRoomRules} from '../src/game/pvp/content-release';
const content=PVP_CONTENT;
const ids=['dark_crypt_whisper','dark_shadow_hand','dark_silence_seal','dark_profane_burial','dark_twisted_curse','dark_despair_tribute','dark_abyss_gaze'];
const heroes=Object.keys(content.heroes);
function take(pool:typeof content.cards[string][],count:number):DeckEntry[]{const out:DeckEntry[]=[];for(const c of pool){const n=Math.min(count,copyLimit(c,DECK_RULES));if(n){out.push({cardId:c.id,count:n});count-=n;}if(!count)break;}expect(count,'catalog must supply a real legal composition').toBe(0);return out;}
function deck(hero:string,n:number){const cards=Object.values(content.cards).filter(c=>c.rarity!=='ULTRA');return[...take(cards.filter(c=>!c.heroId),n),...take(cards.filter(c=>c.heroId===hero),40-n)];}
function profile():PlayerProfile{const p=createProfile(content);for(const hero of heroes){const h=p.heroes[hero]!;for(const c of Object.values(content.cards).filter(c=>c.heroId===hero))h.collection[c.id]={copies:copyLimit(c,DECK_RULES),acquired:0};}p.shared??={collection:{},acquisitions:0};for(const c of Object.values(content.cards).filter(c=>!c.heroId))p.shared.collection[c.id]={copies:copyLimit(c,DECK_RULES),acquired:0};return p;}
describe('Universal cards and unrestricted neutral totals',()=>{
 it('changes only the origin of the seven approved definitions',()=>{const origins=JSON.parse(readFileSync(new URL('../qa/universal-cards-20261125/BASELINE_ORIGINS.json',import.meta.url),'utf8'));expect(Object.keys(content.cards).sort()).toEqual(Object.keys(origins).sort());for(const c of Object.values(content.cards))if(!ids.includes(c.id))expect(c.heroId??null).toBe(origins[c.id]);const old=JSON.parse(readFileSync(new URL('../qa/universal-cards-20261125/BASELINE_CARDS.json',import.meta.url),'utf8'));for(const id of ids){const expected={...old[id]};delete expected.heroId;expect(content.cards[id]).toEqual(expected);for(const hero of [...heroes,'future-champion'])expect(cardsForHero(content,hero).map(c=>c.id)).toContain(id);}});
 for(const hero of heroes)for(const n of [0,4,5,10,20,40])it(`${hero}: legal40 with ${n} neutral copies`,()=>{const d=deck(hero,n);expect(neutralCount(d,content)).toBe(n);expect(validateDeck(d,hero,()=>100,content,DECK_RULES)).toEqual([]);expect(cardsForHero(content,hero).map(c=>c.id)).toEqual(expect.arrayContaining(ids));});
 for(const hero of heroes)it(`${hero}: authoritative loadout, ownership, save and reload`,()=>{const p=profile(),d=deck(hero,40),result=saveActiveDeck(p,hero,d,content,DECK_RULES);expect(result.ok).toBe(true);if(!result.ok)return;const stored=JSON.stringify(result.profile.heroes[hero]!.decks);const parsed=parseProfileSave(serializeProfile(result.profile),content);expect(parsed.status).toBe('OK');if(parsed.status!=='OK')return;expect(JSON.stringify(parsed.profile.heroes[hero]!.decks)).toBe(stored);expect(validateLoadout(parsed.profile,hero,content).cards).toEqual(d);expect(validateDeck([...d,{cardId:'fireball',count:1}],hero,()=>100,content,DECK_RULES).some(i=>i.code==='DECK_TOO_LARGE')).toBe(true);expect(validateDeck(d,hero,()=>0,content,DECK_RULES).some(i=>i.code==='LOCKED')).toBe(true);expect(validateDeck([{cardId:ids[0]!,count:3}],hero,()=>100,content,DECK_RULES).some(i=>i.code==='COPY_LIMIT')).toBe(true);const other=Object.values(content.cards).find(c=>c.heroId&&c.heroId!==hero)!;expect(validateDeck([{cardId:other.id,count:1}],hero,()=>100,content,DECK_RULES).some(i=>i.code==='WRONG_HERO')).toBe(true);});
 it('keeps existing saved decks and copies through origin normalization, idempotently',()=>{const p=profile();for(const id of ids){delete p.shared!.collection[id];p.heroes.mage!.collection[id]={copies:2,acquired:7};}const saved=JSON.stringify(Object.fromEntries(heroes.map(h=>[h,p.heroes[h]!.decks])));const parsed=parseProfileSave(serializeProfile(p),content);expect(parsed.status).toBe('OK');if(parsed.status!=='OK')return;for(const hero of heroes)for(const id of ids)expect(ownedFor(parsed.profile,hero,content)(id)).toBe(2);expect(JSON.stringify(Object.fromEntries(heroes.map(h=>[h,parsed.profile.heroes[h]!.decks])))).toBe(saved);const again=parseProfileSave(serializeProfile(parsed.profile),content);expect(again.status).toBe('OK');if(again.status==='OK')expect(again.profile).toEqual(parsed.profile);});
 for(const hero of heroes)it(`${hero}: auto builder can use an entirely neutral owned pool`,()=>{const result=generateDeck(content,hero,id=>content.cards[id]?.heroId?0:copyLimit(content.cards[id]!,DECK_RULES),DECK_RULES,'BALANCED',42);expect(result.ok).toBe(true);if(result.ok){expect(neutralCount(result.cards,content)).toBe(40);expect(validateDeck(result.cards,hero,()=>100,content,DECK_RULES)).toEqual([]);}});
 for(const hero of heroes)it(`${hero}: Sello can answer with authoritative private view`,()=>{const p=profile(),load=validateLoadout({...p,heroes:{...p.heroes,[hero]:{...p.heroes[hero]!,decks:[{id:'qa',name:'QA',cards:deck(hero,40)}],activeDeckId:'qa'}}},hero,content);const s=createDuel([load,load],7,'DUEL','classic',content),v=duelView(s,s.duel!.active,content);v.player.hand=[{uid:'seal',cardId:'dark_silence_seal'},{uid:'cost',cardId:'first_aid'}];v.player.energy=5;v.phase='ENEMY';v.responseWindow={id:'qa',cardId:'barrier',casterId:'opponent',respondingHeroId:v.player.heroId,deadline:Date.now()+5000};const e=GameEngine.fromSnapshot(v,content,DUEL_SCENARIO);expect(silenceChoices(v,e).map(c=>c.uid)).toEqual(['seal']);});
 for(const hero of heroes)for(const id of ids.filter(id=>id!=='dark_silence_seal'))it(`${hero}: resolves ${id} without class bypasses`,()=>{
 const p=profile();p.heroes[hero]!.decks=[{id:'qa',name:'QA',cards:deck(hero,40)}];p.heroes[hero]!.activeDeckId='qa';const load=validateLoadout(p,hero,content),s=createDuel([load,load],17,'DUEL','classic',content);
 s.player.hand=[{uid:'test',cardId:id},{uid:'cost',cardId:'first_aid'},{uid:'extra',cardId:'shove'}];s.player.energy=5;s.duel!.other.hand=[{uid:'enemy1',cardId:'first_aid'},{uid:'enemy2',cardId:'shove'},{uid:'enemy3',cardId:'take_cover'}];
 const result=applyDuel(s,id==='dark_despair_tribute'?{type:'SEARCH_SUMMON',cardUid:'test',choiceUid:'cost'}:{type:'PLAY_CARD',cardUid:'test',target:null},content);
 expect(result.events.some(e=>e.type==='CARD_PLAYED'&&e.cardId===id)).toBe(true);expect(result.state.player.hand.some(c=>c.uid==='test')).toBe(false);
 if(id==='dark_shadow_hand')expect(result.state.duel!.other.hand.length).toBe(2);
 if(id==='dark_profane_burial')expect(result.state.duel!.other.discard.length).toBe(3);
 if(id==='dark_despair_tribute')expect(result.state.duel!.other.hand.length).toBe(1);
 if(id==='dark_twisted_curse')expect(result.state.duel!.other.deck.filter(c=>c.twistedCurse).length).toBe(1);
 if(id==='dark_abyss_gaze'||id==='dark_crypt_whisper'){const opponent=duelView(result.state,(result.state.duel!.active===0?1:0),content);expect(opponent.player.pendingCardChoice).toBeUndefined();const option=result.state.player.pendingCardChoice?.options[0]?.uid;if(option)expect(JSON.stringify(opponent)).not.toContain('"uid":'+JSON.stringify(option));}
 });
 for(const hero of heroes)for(const id of ids.filter(id=>id!=='dark_silence_seal'))it(`${hero}: PvE keeps original zone prerequisites for ${id}`,()=>{
 const e=makeEngine({hero:{heroId:hero,pos:{x:0,y:2}}},withHeroDeck(content,hero,deck(hero,40)));const uids=setHand(e,[id,'first_aid','shove']);
 const reference=makeEngine({},withHeroDeck(content,'mage',deck('mage',40)));const baseline=setHand(reference,[id,'first_aid','shove']);
 expect(e.getCardPlayability(uids[0]!).playable).toBe(reference.getCardPlayability(baseline[0]!).playable);
 if(id==='dark_crypt_whisper'||id==='dark_abyss_gaze'){const result=e.dispatch({type:'PLAY_CARD',cardUid:uids[0]!,target:null});expect(result.ok).toBe(true);expect(e.state.player.pendingCardChoice).toBeDefined();}
 });
 it('folds old D1 ownership once under concurrent reads without changing decks or totals',async()=>{
 const db=memoryD1(),account=addAccount(db,'universal-fold');const old={...content,cards:{...content.cards}};for(const id of ids)old.cards[id]={...old.cards[id]!,heroId:'mage'};
 const p=createProfile(old);for(const id of ids)p.heroes.mage!.collection[id]={copies:2,acquired:3};
 await createPlayer(db,account.id,'universal-fold',p,[],{source:'QA_BALANCE',importedAt:null,now:1});
 const deckRows=()=>JSON.stringify({headers:db.sql.prepare('SELECT * FROM tactics_decks WHERE user_id=? ORDER BY hero_id,deck_id').all(account.id),cards:db.sql.prepare('SELECT * FROM tactics_deck_cards WHERE user_id=? ORDER BY hero_id,deck_id,card_id').all(account.id)});const decks=deckRows();const total=()=>db.sql.prepare('SELECT SUM(copies) n FROM tactics_player_cards WHERE user_id=? AND card_id LIKE ?').get(account.id,'dark_%');const before=total();
 const [a,b]=await Promise.all([loadPlayer(db,account.id,content),loadPlayer(db,account.id,content)]);expect(total()).toEqual(before);expect(deckRows()).toBe(decks);for(const hero of heroes)for(const id of ids){expect(ownedFor(a!.profile,hero,content)(id)).toBe(2);expect(ownedFor(b!.profile,hero,content)(id)).toBe(2);}await loadPlayer(db,account.id,content);expect(total()).toEqual(before);db.sql.close();
 });
 it('projects ownership only for deferred legacy snapshots without mutating current inventory',()=>{
 const p=profile(),before=JSON.stringify(p),view=legacyOwnershipView(p);
 for(const id of ids){expect(view.heroes.mage!.collection[id]!.copies).toBe(p.shared!.collection[id]!.copies);expect(view.shared!.collection[id]).toBeUndefined();}
 expect(JSON.stringify(p)).toBe(before);expect(legacyOwnershipView(view)).toEqual(view);
 });
 it('does not couple existing authenticated PayPal orders to a card content release',async()=>{
 const db=memoryD1(),env={RELEASE2_CLIENT_REQUIRED:'1',DB:db};
 expect(contentTransition(new Request('https://qa.local/api/tactics/store/paypal/live/orders/existing?clientRelease=winter-dominion-1'),env)).toBeNull();
 expect(contentTransition(new Request('https://qa.local/api/tactics/pvp/create?clientRelease=winter-dominion-1'),env)?.status).toBe(426);const unauth=await handle(new Request('https://qa.local/api/tactics/store/paypal/live/orders/existing?clientRelease=winter-dominion-1'),{...env,DB:db});expect(unauth.status).toBe(401);db.sql.close();
 });
 it('shows an informational counter and isolates old clients without changing Story engine IDs',()=>{const html=renderToStaticMarkup(createElement(NeutralCounter,{count:20}));expect(html.replace(/<[^>]*>/g,'')).toContain('Neutrales: 20');expect(html).not.toMatch(/20\/4|Máximo|db-neutral-meter/);expect(CONTENT_RELEASE).toBe('universal-cards-1');expect(supportsRoomRelease('winter-dominion-1',CONTENT_RELEASE)).toBe(false);expect(canRunRoomRules({game:{},result:null,rulesRelease:'winter-dominion-1'})).toBe(false);expect(DECK_RULES).not.toHaveProperty('maxNeutralCards');});
});
