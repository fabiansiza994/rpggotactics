import {describe,expect,it,vi} from 'vitest';
import {makeEngine,mutable,setHand,unit,p,ctxFor} from './helpers';
import {useBattleStore} from '../src/presentation/store/battleStore';
import {isActionableTile} from '../src/presentation/input/aim';
import {spawnSummon} from '../src/game/domain/summons/summons';
import {STORY_RULES_CURRENT} from '../src/game/run/story-rules';
function setup(mp=3,mode='story'){
 const e=makeEngine({hero:{heroId:'summoner',pos:p(2,2)}});mutable(e).player.energy=4;mutable(e).player.movePoints=mp;mutable(e).round=mp===0?2:4;
 unit(e,e.heroId).hp=18;unit(e,e.heroId).maxHp=18;const uid=setHand(e,['dark_scorpion_king'])[0]!;const send=vi.fn();
 useBattleStore.setState({engine:e,state:e.state,selectedCardUid:uid,scorpionDraft:null,aim:null,pairSelection:null,handDiscard:null,notice:null,playbackBusy:false,introLocked:false,readinessLocked:false,onlineCommand:mode==='story'?null:send,storyRules:mode==='story'?STORY_RULES_CURRENT:null});
 return {e,uid,send,s:()=>useBattleStore.getState()};
}
describe('Scorpion target collection before explicit sacrifice',()=>{
 it('previews valid geometry without executing an incomplete cast',()=>{const{e,uid}=setup();const before=JSON.stringify(e.state);expect(e.getValidTargets(uid)).toContainEqual(p(3,2));expect(e.previewCard(uid,p(3,2)).valid).toBe(true);expect(isActionableTile(e,uid,p(3,2))).toBe(true);expect(JSON.stringify(e.state)).toBe(before);expect(e.previewCard(uid,p(2,2)).valid).toBe(false);});
 it.each(['mouse','touch'])('%s opens draft immediately without spending',input=>{const{e,uid,s}=setup();const before=JSON.stringify(e.state);if(input==='mouse')s().clickTile(p(3,2));else s().tapTile([p(3,2)]);expect(s().scorpionDraft).toEqual({cardUid:uid,position:p(3,2)});expect(JSON.stringify(e.state)).toBe(before);});
 it.each([0,3])('works with %s MP and occupied capacity in Story and online transports',mp=>{for(const mode of ['story','ranked','pvp']){const{e,uid,s,send}=setup(mp,mode);spawnSummon(ctxFor(e),unit(e,e.heroId),'wolf',p(1,2));s().tapTile([p(3,2)]);expect(s().scorpionDraft?.cardUid).toBe(uid);expect(send).not.toHaveBeenCalled();s().confirmScorpion(9);s().confirmScorpion(9);if(mode==='story'){expect(unit(e,e.heroId).hp).toBe(9);expect(e.state.units.find(u=>u.defId==='dark_scorpion_king')?.hp).toBe(15);}else expect(send).toHaveBeenCalledExactlyOnceWith({type:'PLAY_CARD',cardUid:uid,target:p(3,2),sacrificeHp:9});}});
 it.each([9,17])('resolves %s HP once with 4 energy',n=>{const{e,s}=setup(0);s().tapTile([p(3,2)]);s().confirmScorpion(n);s().confirmScorpion(n);expect(unit(e,e.heroId).hp).toBe(18-n);expect(e.state.player.energy).toBe(0);expect(e.state.units.filter(u=>u.defId==='dark_scorpion_king')).toHaveLength(1);expect(e.state.units.find(u=>u.defId==='dark_scorpion_king')).toMatchObject({hp:6+n,maxHp:6+n,summon:{capacityCost:0}});});
 it('invalid targets keep selection, cancel spends nothing',()=>{for(const input of ['mouse','touch']){const{e,uid,s}=setup();const before=JSON.stringify(e.state);if(input==='mouse')s().clickTile(p(2,2));else s().tapTile([p(2,2)]);expect(s().scorpionDraft).toBeNull();expect(s().selectedCardUid).toBe(uid);expect(s().notice).toBeTruthy();s().tapTile([p(3,2)]);s().cancelAim();expect(s().scorpionDraft).toBeNull();expect(JSON.stringify(e.state)).toBe(before);}});
});
