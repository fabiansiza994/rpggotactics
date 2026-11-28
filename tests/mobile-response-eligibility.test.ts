import {describe,it,expect} from 'vitest';
import {DEFAULT_CONTENT,createProfile} from '../src/game';
import {withDarkLightRelease} from '../src/game/data/dark-light';
import {createDuel,validateLoadout,applyDuel,duelView} from '../src/game/pvp/duel';
import {hasLegalSilenceResponse,checkSilenceResponse} from '../src/game/domain/cards/silence-eligibility';
const content=withDarkLightRelease(DEFAULT_CONTENT);
function fixture(){const p=createProfile(content),l=validateLoadout(p,'mage',content),s=createDuel([l,l],17,'DUEL','classic',content);s.player.energy=7;s.duel!.other.energy=3;s.player.hand=[{uid:'cast',cardId:'magic_missile'},{uid:'second',cardId:'magic_missile'}];s.duel!.other.hand=[{uid:'seal',cardId:'dark_silence_seal'},{uid:'cost',cardId:'fireball'}];s.units.find(u=>u.id===s.player.heroId)!.pos={x:2,y:2};s.units.find(u=>u.id===s.duel!.other.heroId)!.pos={x:3,y:2};return s}
const ctx=(s:ReturnType<typeof fixture>)=>({state:s,content,emit:()=>{}});
const cast=(s=fixture(),uid='cast')=>applyDuel(s,{type:'PLAY_CARD',cardUid:uid,target:s.units.find(u=>u.id===s.duel!.other.heroId)!.pos},content);
function immediate(s:ReturnType<typeof fixture>){const hp=s.units.find(u=>u.id===s.duel!.other.heroId)!.hp,energy=s.player.energy;const r=cast(s);expect(r.state.pendingCast).toBeUndefined();expect(r.events.some(e=>e.type==='CARD_CAST_PENDING')).toBe(false);expect(r.events.filter(e=>e.type==='UNIT_DAMAGED')).toHaveLength(1);expect(r.state.units.find(u=>u.id===s.duel!.other.heroId)!.hp).toBe(hp-2);expect(r.state.player.energy).toBe(energy-1);return r}
describe('Only executable legal responses open an authoritative window',()=>{
 it('without Seal resolves immediately with no countdown/event/pending state',()=>{const s=fixture();s.duel!.other.hand=[{uid:'private',cardId:'fireball'}];immediate(s)});
 it('insufficient energy does not open a window',()=>{const s=fixture();s.duel!.other.energy=1;immediate(s)});
 it('a Seal alone cannot pay its distinct discard',()=>{const s=fixture();s.duel!.other.hand=s.duel!.other.hand.slice(0,1);immediate(s)});
 it('unavailable Seal is not executable',()=>{const s=fixture();s.duel!.other.hand[0]!.unavailableThisTurn=true;immediate(s)});
 it('existing search lock prevents both admission and execution',()=>{const s=fixture();s.duel!.other.searchBlockedCardIds=['dark_silence_seal'];expect(checkSilenceResponse(ctx(s),'seal','cost').ok).toBe(false);immediate(s)});
 it('incapacitation prevents response',()=>{const s=fixture();s.units.find(u=>u.id===s.duel!.other.heroId)!.statuses.push({id:'STUNNED',turnsLeft:1});immediate(s)});
 it('the existing neutral Seal remains legal for other champions',()=>{const s=fixture();s.units.find(u=>u.id===s.duel!.other.heroId)!.defId='summoner';expect(cast(s).state.pendingCast).toBeDefined()});
 it('uses the effective discounted cost without consuming the discount in the query',()=>{const s=fixture();s.duel!.other.energy=1;const u=s.units.find(u=>u.id===s.duel!.other.heroId)!;u.costDiscounts=[{amount:1,scope:'SPELL',sourceCardId:'arcane_confluence'}];const before=JSON.stringify(s);expect(hasLegalSilenceResponse(ctx(s))).toBe(true);expect(JSON.stringify(s)).toBe(before);expect(cast(s).state.pendingCast).toBeDefined()});
 it('valid Seal opens exactly one window, pass resolves one debit and no second window',()=>{const s=cast().state;expect(s.pendingCast).toBeDefined();s.pendingCast!.deadline=777;const r=applyDuel(s,{type:'SILENCE_RESPONSE',windowId:s.pendingCast!.id,pass:true},content);expect(r.state.pendingCast).toBeUndefined();expect(r.state.player.energy).toBe(6);expect(r.events.filter(e=>e.type==='CARD_PLAYED')).toHaveLength(1)});
 it('successful negation pays Seal and one discard once',()=>{const a=cast(),s=a.state,hp=s.units.find(u=>u.id===s.duel!.other.heroId)!.hp;const r=applyDuel(s,{type:'SILENCE_RESPONSE',windowId:s.pendingCast!.id,pass:false,sealUid:'seal',discardUid:'cost'},content);expect(r.state.duel!.other.energy).toBe(1);expect(r.state.duel!.other.hand).toEqual([]);expect(r.state.units.find(u=>u.id===s.duel!.other.heroId)!.hp).toBe(hp);expect(r.events.filter(e=>e.type==='CARD_NEGATED')).toHaveLength(1)});
 it('consecutive casts with no response resolve in their own commands',()=>{const s=fixture();s.duel!.other.hand=[];const a=immediate(s),b=cast(a.state,'second');expect(b.state.pendingCast).toBeUndefined();expect(b.state.player.energy).toBe(5);expect(b.events.some(e=>e.type==='CARD_CAST_PENDING')).toBe(false)});
 it('cursed activating card retains priority and never creates a window',()=>{const s=fixture();s.player.hand[0]!.twistedCurse=true;const r=cast(s);expect(r.state.pendingCast).toBeUndefined();expect(r.events.some(e=>e.type==='CARD_CURSE_TRIGGERED')).toBe(true);expect(r.events.some(e=>e.type==='UNIT_DAMAGED'&&e.unitId===s.duel!.other.heroId)).toBe(false)});
 it('hidden curse on a Seal remains hidden until attempted response and does not negate original',()=>{const s=fixture();s.duel!.other.hand[0]!.twistedCurse=true;const a=cast(s).state;expect(a.pendingCast).toBeDefined();expect(duelView(a,1,content).player.hand.find(c=>c.uid==='seal')?.twistedCurse).toBeUndefined();const r=applyDuel(a,{type:'SILENCE_RESPONSE',windowId:a.pendingCast!.id,pass:false,sealUid:'seal',discardUid:'cost'},content);expect(r.events.some(e=>e.type==='CARD_CURSE_TRIGGERED')).toBe(true);expect(r.events.some(e=>e.type==='CARD_NEGATED')).toBe(false);expect(r.events.some(e=>e.type==='CARD_PLAYED'&&e.cardId==='magic_missile')).toBe(true)});
 it('a legitimately traded Seal follows the existing controller/class exception',()=>{const s=fixture(),u=s.units.find(u=>u.id===s.duel!.other.heroId)!;u.defId='summoner';Object.assign(s.duel!.other.hand[0]!,{traded:true,originalOwnerId:s.player.heroId,controllerId:u.id});const a=cast(s).state;expect(a.pendingCast).toBeDefined();const r=applyDuel(a,{type:'SILENCE_RESPONSE',windowId:a.pendingCast!.id,pass:false,sealUid:'seal',discardUid:'cost'},content);expect(r.events.some(e=>e.type==='CARD_NEGATED')).toBe(true)});
 it('snapshots expose the public window only, never a Seal/discard identity or eligibility reason',()=>{const s=cast().state;s.pendingCast!.deadline=5555;for(const seat of[0,1]as const){const v=duelView(s,seat,content);expect(v.pendingCast).toBeUndefined();expect(Object.keys(v.responseWindow!).sort()).toEqual(['announcement','cardId','casterId','deadline','durationMs','id','respondingHeroId']);expect(v.responseWindow!.deadline).toBe(5555);expect(v.duel).toBeUndefined()}const a=duelView(s,s.duel!.active,content);expect(JSON.stringify(a.responseWindow)).not.toContain('seal');expect(a.player.hand.some(c=>c.uid==='seal')).toBe(false)});
 it('rechecks eligibility on execution without spending anything on an invalid response',()=>{const s=cast().state;s.duel!.other.energy=0;const before=JSON.stringify(s);expect(()=>applyDuel(s,{type:'SILENCE_RESPONSE',windowId:s.pendingCast!.id,pass:false,sealUid:'seal',discardUid:'cost'},content)).toThrow('NOT_ENOUGH_ENERGY');expect(JSON.stringify(s)).toBe(before)});
 it('Seal actually obtained through Trueque can negate with the receiving champion',()=>{
  const s=fixture(),a=s.player.heroId,b=s.duel!.other.heroId;
  s.units.find(u=>u.id===a)!.defId='summoner';
  s.player.hand=[{uid:'barter',cardId:'dark_goblin_barter'},{uid:'offer',cardId:'summoner_push'},{uid:'keep',cardId:'nurture'}];
  s.duel!.other.hand=[{uid:'seal',cardId:'dark_silence_seal'}];
  const exchanged=applyDuel(s,{type:'SEARCH_SUMMON',cardUid:'barter',choiceUid:'offer'},content);
  expect(exchanged.state.pendingCast).toBeUndefined();
  expect(exchanged.state.player.hand.find(c=>c.uid==='seal')).toMatchObject({traded:true,controllerId:a,originalOwnerId:b});
  const turn=applyDuel(exchanged.state,{type:'END_TURN'},content);
  turn.state.player.energy=5;turn.state.duel!.other.energy=5;
  const cast=applyDuel(turn.state,{type:'PLAY_CARD',cardUid:'offer',target:turn.state.units.find(u=>u.id===a)!.pos},content);
  expect(cast.state.pendingCast).toBeDefined();
  const result=applyDuel(cast.state,{type:'SILENCE_RESPONSE',windowId:cast.state.pendingCast!.id,pass:false,sealUid:'seal',discardUid:'keep'},content);
  expect(result.events.filter(e=>e.type==='CARD_NEGATED')).toHaveLength(1);
  expect(result.state.duel!.other.discard.filter(c=>c.uid==='seal')).toHaveLength(1);
 });

});
