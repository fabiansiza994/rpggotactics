import {Container} from 'pixi.js';
import {ElementEffects} from '../src/presentation/vfx/ElementEffects';
import {describe,it,expect} from 'vitest';
import {GameEngine,type GameEvent} from '../src/game';
import {ctxFor,makeEngine,mutable,p,setHand} from './helpers';
import {dealDamage} from '../src/game/domain/combat/damage';
import {snowTurnEnd} from '../src/game/domain/combat/snow';
import {actSummons} from '../src/game/domain/summons/summons';
import {compileTimeline} from '../src/presentation/vfx/spellTimeline';
import {CharacterAnimator} from '../src/presentation/pixi/CharacterAnimator';
import {CHARACTER_ANIMATIONS} from '../src/presentation/pixi/characterAnimations';
import {SNOW_SOLDIER_ANIMATION_STATUS,SNOW_SOLDIER_ATLAS_CONTRACT,snowVisualAge} from '../src/presentation/pixi/snowSoldierAnimations';
const setup=(world=false)=>{const e=makeEngine({hero:{heroId:'mage',pos:p(1,2)},enemies:[{id:'orc',enemyId:'orc_warrior',pos:p(3,2)}]});mutable(e).player.energy=30;const cast=(id:string,target:ReturnType<typeof p>|null)=>{const [uid]=setHand(e,[id]);expect(e.dispatch({type:'PLAY_CARD',cardUid:uid!,target}).ok).toBe(true);};if(world)cast('absolute_zero',null);cast('snow_soldier',p(2,2));return e;};
const soldier=(e:GameEngine)=>e.state.units.find(u=>u.defId==='snow_soldier')!;
describe('Snow Soldier presentation integration — NOT visual approval',()=>{
 it('approved atlas enters normal runtime registry without QA flags',()=>{expect(SNOW_SOLDIER_ANIMATION_STATUS).toBe('APPROVED');expect(CHARACTER_ANIMATIONS.snow_soldier).toEqual(SNOW_SOLDIER_ATLAS_CONTRACT);});
 it('contract uses existing eight-action controller, no overlapping cells',()=>{const clips=Object.values(SNOW_SOLDIER_ATLAS_CONTRACT.clips),cells=clips.flatMap(c=>Array.from({length:c!.count},(_,i)=>c!.start+i));expect(new Set(cells).size).toBe(53);expect(clips).toHaveLength(9);expect(SNOW_SOLDIER_ATLAS_CONTRACT.clips.attack?.contactFrame).toBe(3);expect(SNOW_SOLDIER_ATLAS_CONTRACT.clips.cast?.contactFrame).toBe(3);});
 for(const motion of ['death','melt','fire_death'] as const)it(`${motion} is terminal and cannot be interrupted`,()=>{const frames:string[]=[];const a=new CharacterAnimator(SNOW_SOLDIER_ATLAS_CONTRACT.clips,(m,f)=>frames.push(m+':'+f),()=>{});expect(a.play(motion)).toBe(true);a.tick(10000,false);expect(a.dead).toBe(true);expect(a.play('walk')).toBe(false);expect(a.play('hit')).toBe(false);expect(a.state).toBe(motion);a.reset();expect(a.dead).toBe(false);expect(a.state).toBe('idle');});
 it('melee contact uses authored frame at the visual impact beat',()=>{const a=new CharacterAnimator(SNOW_SOLDIER_ATLAS_CONTRACT.clips,()=>{},()=>{});a.play('attack',180);a.tick(179,false);expect(a.frameIndex).toBeLessThan(3);a.tick(1,false);expect(a.frameIndex).toBe(3);});
 for(const reason of ['DAMAGE','MELT','FIRE'] as const)it(`authoritative ${reason} defeat cause, one removal only`,()=>{const e=setup(),s=soldier(e),events:GameEvent[]=[],ctx=ctxFor(e,events);if(reason==='MELT'){s.summon!.meltTurnsLeft=1;snowTurnEnd(ctx,s);}else dealDamage(ctx,s,reason==='FIRE'?1:99,'orc',reason==='FIRE'?'FIRE':'PHYSICAL','DIRECT_MELEE');expect(e.state.units.some(u=>u.id===s.id)).toBe(false);expect(events.filter(x=>x.type==='UNIT_DEFEATED')).toMatchObject([{reason,unitId:s.id}]);snowTurnEnd(ctx,s);expect(events.filter(x=>x.type==='UNIT_DEFEATED')).toHaveLength(1);});
 it('ordinary melee emits no snowball; HP projection follows attack contact',()=>{const e=setup(),events:GameEvent[]=[];mutable(e).round=soldier(e).summon!.readyRound;actSummons(ctxFor(e,events),e.heroId);expect(events.some(e=>e.type==='SUMMON_ATTACKED')).toBe(true);expect(events.some(e=>e.type==='SNOWBALL_FIRED')).toBe(false);const t=compileTimeline(events,id=>id,false);const a=t.cues.find(c=>c.event.type==='SUMMON_ATTACKED'&&c.kind==='event')!,hit=t.cues.find(c=>c.event.type==='UNIT_DAMAGED')!;expect(a.at+a.duration).toBe(hit.at);});
 it('World snowball has one windup and one flight before HP; no duplicate melee animation',()=>{const e=setup(true),events:GameEvent[]=[];mutable(e).round=soldier(e).summon!.readyRound;actSummons(ctxFor(e,events),e.heroId);expect(events.some(e=>e.type==='SNOWBALL_FIRED')).toBe(true);const t=compileTimeline(events,id=>id,false);expect(t.cues.filter(c=>c.event.type==='SUMMON_ATTACKED')).toHaveLength(0);const wind=t.cues.find(c=>c.event.type==='SNOWBALL_FIRED'&&c.kind==='event')!,flight=t.cues.find(c=>c.event.type==='SNOWBALL_FIRED'&&c.kind==='projectile')!,hit=t.cues.find(c=>c.event.type==='UNIT_DAMAGED')!;expect(wind.at+wind.duration).toBe(flight.at);expect(hit.at).toBe(flight.at+flight.duration);expect(hit.event.type==='UNIT_DAMAGED'&&hit.event.hpLost).toBeGreaterThan(0);});
 for(const remaining of [5,4,3,2,1])it(`snapshot age ${remaining} restores without resetting and world shows whole figure`,()=>{const e=setup();soldier(e).summon!.meltTurnsLeft=remaining;const restored=GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),e.content,e.scenario);expect(snowVisualAge(soldier(restored).summon!.meltTurnsLeft!,false)).toBe(remaining);expect(snowVisualAge(remaining,true)).toBe(5);});
});

it('snow projectile reuses graphics and clear cancels flight without stale impact',()=>{
 const layer=new Container(),projectiles=new Container(),fx=new ElementEffects(layer,projectiles,p=>({x:p.x*96,y:p.y*96}));
 const initial=layer.children.length;
 fx.snowball(p(0,0),p(1,0),420);expect(layer.children.length).toBe(initial+1);
 const ball=layer.children.at(-1);for(let i=0;i<10;i++)fx.tick(16);expect(layer.children.at(-1)).toBe(ball);
 fx.clear();expect(layer.children.length).toBe(initial);fx.tick(1000);expect(layer.children.length).toBe(initial);
 fx.snowball(p(0,0),p(1,0),420);expect(layer.children.at(-1)).toBe(ball);fx.tick(420);fx.tick(200);expect(layer.children.length).toBe(initial);
 fx.destroy();expect(layer.children).toHaveLength(0);
});
