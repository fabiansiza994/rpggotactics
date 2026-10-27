import{describe,it,expect}from'vitest';
import{DEFAULT_CONTENT,GameEngine,type GameContent,type Command}from'../src/game';
import{makeEngine,mutable,setHand,scenario}from'./helpers';
import{summonSearchChoices}from'../src/game/domain/cards/play-card';
import{replayBattle}from'../src/game/engine/replay';
import{parseCommand}from'../src/game/run/verify';
import{applyDuel,createDuel,duelEvents,duelView}from'../src/game/pvp/duel';
import{fallbackDiscardUid}from'../src/game/domain/cards/hand-limit';
import{validCommand}from'../server/src/pvp';

function fixture(){const e=makeEngine({hero:{heroId:'summoner',pos:{x:0,y:2}}});setHand(e,['pack_tracking','summon_chicken']);mutable(e).player.deck=[{uid:'chosen',cardId:'summon_chicken'},{uid:'other',cardId:'summon_chicken'},{uid:'support',cardId:'nurture'}];return e;}
const end=(s:import('../src/game').GameState):Command=>{const uid=fallbackDiscardUid(s);return uid?{type:'END_TURN',discardUid:uid}:{type:'END_TURN'};};
const command:Command={type:'SEARCH_SUMMON',cardUid:'test-pack_tracking-0',choiceUid:'chosen'};
describe('Rastreo de la Manada',()=>{
 it('searches the exact instance atomically, spends once, preserves other copies and RNG',()=>{
  const e=fixture(),rng=e.state.rngState;expect(e.dispatch(command).ok).toBe(true);
  expect(e.state.player.energy).toBe(3);expect(e.state.player.discard.at(-1)?.cardId).toBe('pack_tracking');
  expect(e.state.player.hand.find(c=>c.uid==='chosen')?.unavailableThisTurn).toBe(true);
  expect(e.state.player.hand.find(c=>c.uid==='test-summon_chicken-1')?.unavailableThisTurn).toBeUndefined();
  expect(e.state.player.deck.map(c=>c.uid)).toEqual(['other','support']);expect(e.state.rngState).toBe(rng);
  expect(e.getCardPlayability('chosen')).toMatchObject({playable:false,reason:'CARD_UNAVAILABLE_THIS_TURN'});
  expect(e.dispatch({type:'PLAY_CARD',cardUid:'chosen',target:{x:1,y:2}})).toMatchObject({ok:false,error:'CARD_UNAVAILABLE_THIS_TURN'});
 });
 it.each(['missing','support','test-summon_chicken-1'])('rejects an ineligible/missing/not-in-deck choice %s without side effects',choiceUid=>{
  const e=fixture(),before=structuredClone(e.state);expect(e.dispatch({...command,choiceUid}).ok).toBe(false);expect(e.state).toEqual(before);
 });
 it.each([['full','SEARCH_HAND_FULL'],['empty','NO_ELIGIBLE_SUMMON'],['energy','NOT_ENOUGH_ENERGY'],['turn','NOT_PLAYER_TURN']] as const)('blocks %s without paying',(kind,error)=>{
  const e=fixture(),s=mutable(e);if(kind==='full')s.player.hand.push(...Array.from({length:4},(_,i)=>({uid:'f'+i,cardId:'nurture'})));
  if(kind==='empty')s.player.deck=[{uid:'support',cardId:'nurture'}];if(kind==='energy')s.player.energy=0;if(kind==='turn')s.phase='ENEMY';
  const before=structuredClone(e.state);expect(e.dispatch(command)).toMatchObject({ok:false,error});expect(e.state).toEqual(before);
 });
 it('five-card hand stays five, and ordinary PLAY_CARD cannot bypass the choice',()=>{
  const e=fixture();mutable(e).player.hand.push(...Array.from({length:3},(_,i)=>({uid:'f'+i,cardId:'nurture'})));
  const before=structuredClone(e.state);expect(e.dispatch({type:'PLAY_CARD',cardUid:command.cardUid,target:null}).ok).toBe(false);expect(e.state).toEqual(before);
  expect(e.dispatch(command).ok).toBe(true);expect(e.state.player.hand).toHaveLength(5);
 });
 it('restores the per-instance lock and releases at next own turn',()=>{
  const e=fixture();e.dispatch(command);const restored=GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),e.content,e.scenario);
  expect(restored.getCardPlayability('chosen').playable).toBe(false);expect(restored.dispatch({type:'END_TURN'}).ok).toBe(true);
  expect(restored.state.player.hand.find(c=>c.uid==='chosen')?.unavailableThisTurn).toBeUndefined();
 });
 it('roundtrips the command through the server parser and replays identically',()=>{
  const hero={...DEFAULT_CONTENT.heroes.summoner!,startingHandSize:1,deck:[{cardId:'pack_tracking',count:29},{cardId:'summon_chicken',count:1}]};
  const content:GameContent={...DEFAULT_CONTENT,heroes:{...DEFAULT_CONTENT.heroes,summoner:hero}};
  const sc=scenario({hero:{heroId:'summoner',pos:{x:0,y:2}}});const e=new GameEngine(sc,content,42);
  const cmd:Command={type:'SEARCH_SUMMON',cardUid:e.state.player.hand[0]!.uid,choiceUid:summonSearchChoices(e.state,content)[0]!.uid};
  expect(parseCommand({...cmd,forged:'ignored'})).toEqual(cmd);expect(validCommand(cmd)).toBe(true);expect(validCommand({...cmd,choiceUid:1})).toBe(false);
  expect(e.dispatch(cmd).ok).toBe(true);const replay=replayBattle(sc,content,42,[cmd]);expect(replay.rejectedAt).toBeNull();expect(replay.state).toEqual(e.state);
 });
 it('PvP keeps opponent identities private, validates choices and unlocks only on owner turn',()=>{
  let s=createDuel([{heroId:'summoner',cards:DEFAULT_CONTENT.heroes.summoner!.deck},{heroId:'mage',cards:DEFAULT_CONTENT.heroes.mage!.deck}],42);
  const owner=s.duel!.active,other=owner===0?1:0;
  // Ensure active test caster is Summoner independently of deterministic first-seat selection.
  if(s.units.find(u=>u.id===s.player.heroId)!.defId!=='summoner')s=applyDuel(s,end(s)).state;
  const seat=s.duel!.active,rival=seat===0?1:0;
  s.player.hand=[{uid:command.cardUid,cardId:'pack_tracking'}];s.player.deck=[{uid:'chosen',cardId:'summon_chicken'},{uid:'secret',cardId:'summon_wolf'}];
  expect(duelView(s,seat).player.deck).toEqual([]);expect(duelView(s,seat).searchChoices).toHaveLength(2);
  expect(JSON.stringify(duelView(s,rival))).not.toContain('secret');
  expect(()=>applyDuel(s,{...command,choiceUid:'forged'})).toThrow();const result=applyDuel(s,command);s=result.state;
  expect(duelEvents(s,rival,result.events).some(e=>e.type==='CARD_DRAWN')).toBe(false);
  s=applyDuel(s,end(s)).state;expect(s.duel!.other.hand[0]!.unavailableThisTurn).toBe(true);
  s=applyDuel(s,end(s)).state;expect(s.player.hand.find(c=>c.uid==='chosen')?.unavailableThisTurn).toBeUndefined();
  expect(owner!==other).toBe(true);
 });
 it('keeps pack_call and the real starter unchanged',()=>{expect(DEFAULT_CONTENT.cards.pack_call!.category).toBe('MOVEMENT');expect(DEFAULT_CONTENT.heroes.summoner!.deck.some(c=>c.cardId==='pack_tracking')).toBe(false);});
});
