import { expect, it } from 'vitest';
import { GameEngine, createProfile } from '../src/game';
import { createDuel, duelView, validateLoadout, DUEL_SCENARIO } from '../src/game/pvp/duel';
import { PVP_CONTENT } from '../server/src/pvp';
import { DARK_LIGHT_CARDS } from '../src/game/data/dark-light';
import { requiredRivalZones } from '../src/game/domain/cards/rival-zones';
import { makeEngine, setHand, mutable } from './helpers';
const affected = ['dark_shadow_hand','dark_profane_burial','dark_despair_tribute','dark_twisted_curse'];
function realBanks() {
 const profile=createProfile(PVP_CONTENT), load=validateLoadout(profile,'mage',PVP_CONTENT);
 return createDuel([load,load],47,'DUEL','classic',PVP_CONTENT);
}
it('catalog audit identifies precisely four effects requiring real rival zones',()=>{
 expect(DARK_LIGHT_CARDS.filter(c=>requiredRivalZones(c).length).map(c=>c.id).sort()).toEqual([...affected].sort());
 expect(requiredRivalZones(PVP_CONTENT.cards.dark_shadow_hand!)).toEqual(['HAND']);
 expect(requiredRivalZones(PVP_CONTENT.cards.dark_profane_burial!)).toEqual(['DECK']);
});
it.each(affected)('PvE without rival bank rejects %s before payment, targeting and discard',id=>{
 const e=makeEngine(); const [uid]=setHand(e,[id]); mutable(e).player.energy=20;
 const check=e.getCardPlayability(uid!);expect(check.playable).toBe(false);if(!check.playable)expect(check.reason).toBe('RIVAL_ZONE_UNAVAILABLE');
 expect(e.getValidTargets(uid!)).toEqual([]);
 const before=JSON.stringify(e.state);
 expect(e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:e.state.units.find(u=>u.id===e.heroId)!.pos}).ok).toBe(false);
 expect(JSON.stringify(e.state)).toBe(before);
});
it.each(affected)('real banks permit %s regardless of mode label, preserving hidden client projection',id=>{
 for (const projected of [false,true]) {
 const state=realBanks();state.player.energy=20;state.player.hand=[{uid:'cast',cardId:id},{uid:'payment',cardId:'fireball'}];
 const snapshot=projected?duelView(state,state.duel!.active,PVP_CONTENT):state;
 const e=GameEngine.fromSnapshot(snapshot,PVP_CONTENT,DUEL_SCENARIO);
 expect(e.getCardPlayability('cast').playable).toBe(true);
 if(projected){expect(e.state.duel).toBeUndefined();expect(e.state.player.deck).toEqual([]);}
 }
 // A PvE encounter can supply the same real-bank contract; mode name itself is not an eligibility gate.
 const e=makeEngine(), state=mutable(e), banks=realBanks();state.duel=banks.duel;
 state.player.energy=20;const [uid]=setHand(e,[id,'fireball']);expect(e.getCardPlayability(uid!).playable).toBe(true);
 expect(e.dispatch(id==='dark_despair_tribute'?{type:'SEARCH_SUMMON',cardUid:uid!,choiceUid:state.player.hand.find(c=>c.uid!==uid)!.uid}:{type:'PLAY_CARD',cardUid:uid!,target:state.units.find(u=>u.id===e.heroId)!.pos}).ok).toBe(true);
});
it.each(affected)('existing empty zone is an unmet precondition, not an absent zone: %s',id=>{
 const state=realBanks(); state.player.energy=20;state.player.hand=[{uid:'cast',cardId:id},{uid:'payment',cardId:'fireball'}];
 state.duel!.other.hand=[];state.duel!.other.deck=[];
 const e=GameEngine.fromSnapshot(state,PVP_CONTENT,DUEL_SCENARIO);
 const check=e.getCardPlayability('cast');expect(check.playable).toBe(false);if(!check.playable)expect(check.reason).toBe('INVALID_TARGET');
});
it('Tribute needs two, burial permits one, curse excludes already-cursed instances',()=>{
 const state=realBanks(); state.player.energy=20;state.duel!.other.hand=[{uid:'one',cardId:'fireball'}];state.duel!.other.deck=[{uid:'last',cardId:'fireball',twistedCurse:true}];
 const e=GameEngine.fromSnapshot(state,PVP_CONTENT,DUEL_SCENARIO);
 for(const [id,playable] of [['dark_shadow_hand',true],['dark_despair_tribute',false],['dark_profane_burial',true],['dark_twisted_curse',false]] as const){mutable(e).player.hand=[{uid:'test',cardId:id}];expect(e.getCardPlayability('test').playable).toBe(playable);}
});
it('own deck choices and ordinary damage do not require a rival bank',()=>{
 const e=makeEngine(); const [uid]=setHand(e,['dark_crypt_whisper']);mutable(e).player.energy=20;
 expect(e.getCardPlayability(uid!).playable).toBe(true);
});

it('forged public counts never replace authoritative instances or authorize payment',()=>{
 const e=makeEngine();const [uid]=setHand(e,['dark_shadow_hand']);const s=mutable(e);s.player.energy=20;s.pileCounts={deck:20,discard:0,opponentDeck:20,opponentHand:5,opponentDiscard:0};
 const before=JSON.stringify(e.state);expect(e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:null}).ok).toBe(false);expect(JSON.stringify(e.state)).toBe(before);
});
