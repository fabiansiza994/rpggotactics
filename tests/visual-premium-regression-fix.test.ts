import { beforeEach, describe, expect, it } from 'vitest';
import { useBattleStore } from '../src/presentation/store/battleStore';
import { idleDisplacement } from '../src/presentation/pixi/idleBreathing';
import { CHARACTER_ANIMATIONS } from '../src/presentation/pixi/characterAnimations';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';

describe('turn notification identity', () => {
 beforeEach(()=>useBattleStore.setState({turnBanner:null,playbackBusy:false}));
 it('preserves the notification across action playback and duplicate snapshots',()=>{
  const s=useBattleStore.getState();s.showTurnBanner('PLAYER',1);const first=useBattleStore.getState().turnBanner;
  for(let i=0;i<6;i++){useBattleStore.setState({playbackBusy:i%2===0});s.showTurnBanner('PLAYER',1);expect(useBattleStore.getState().turnBanner).toBe(first);}
  s.showTurnBanner('ENEMY',1);s.showTurnBanner('PLAYER',2);expect(useBattleStore.getState().turnBanner).toEqual({id:3,faction:'PLAYER',round:2});
 });
 it('permits the same round for a genuinely new battle',()=>{const s=useBattleStore.getState();s.showTurnBanner('PLAYER',1);const old=useBattleStore.getState().turnBanner;useBattleStore.setState({turnBanner:null});s.showTurnBanner('PLAYER',1);expect(useBattleStore.getState().turnBanner).not.toBe(old);});
});
describe('grounded enemy idle',()=>{
 for(const id of ['orc_warrior','dark_shaman','stone_brute','shadow_wolf']){
 it(`${id} preserves feet and still breathes`,()=>{let upper=0;for(let t=0;t<7;t+=.4)for(let x=0;x<=1;x+=.1){for(const y of [.78,.85,.95,1])expect(idleDisplacement(id,x,y,t)).toEqual({x:0,y:0});const d=idleDisplacement(id,x,.5,t);upper+=Math.abs(d.x)+Math.abs(d.y);}expect(upper).toBeGreaterThan(0);});
 it(`${id} keeps contact/action clips and returns to grounded rest`,()=>{const config=CHARACTER_ANIMATIONS[id]!.clips;const frames:Array<[string,number]>=[];const a=new CharacterAnimator(config,(m,f)=>frames.push([m,f]),()=>{});for(let i=0;i<50;i++)a.tick(100,false);expect(a.frameIndex).toBe(0);const motion=config.attack?'attack':'cast';expect(a.play(motion)).toBe(true);for(let i=0;i<20;i++)a.tick(100,false);expect(frames.some(([m,f])=>m===motion&&f>0)).toBe(true);expect(a.state).toBe('idle');expect(a.frameIndex).toBe(0);expect(config.walk??config.run??config.walk_heavy).toBeDefined();});
 }
 it('retains valid authored Mage and Golem idle cycles',()=>{expect(CHARACTER_ANIMATIONS.mage!.clips.idle?.animatedIdle).toBe(true);expect(CHARACTER_ANIMATIONS.pact_golem!.clips.idle?.animatedIdle).toBe(true);});
});
