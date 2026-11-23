import {describe,it,expect} from 'vitest';
import {makeEngine,mutable,setHand,ctxFor,p} from './helpers';
import {GameEngine} from '../src/game/engine/GameEngine';
import {resolveGlyphs} from '../src/game/domain/combat/glyphs';
import {dealDamage} from '../src/game/domain/combat/damage';
import {DEFAULT_CONTENT,createProfile} from '../src/game';
import {createDuel,applyDuel,duelView,validateLoadout} from '../src/game/pvp/duel';
import {compileTimeline} from '../src/presentation/vfx/spellTimeline';
const id='eternal_winter_heart';
function setup(world=false){const e=makeEngine({hero:{heroId:'mage',pos:p(1,2)},enemies:[{id:'prey',enemyId:'stone_brute',pos:p(3,2)},{id:'adjacent',enemyId:'stone_brute',pos:p(3,3)}]});const s=mutable(e);s.player.energy=30;for(const u of s.units)u.armor=0;if(world)s.units.find(u=>u.id===e.heroId)!.statuses.push({id:'ABSOLUTE_ZERO',turnsLeft:10});setHand(e,[id]);return e;}
const cast=(e:GameEngine,at=p(3,2))=>e.dispatch({type:'PLAY_CARD',cardUid:`test-${id}-0`,target:at});
function advance(e:GameEngine){mutable(e).round++;const events:import('../src/game').GameEvent[]=[];resolveGlyphs(ctxFor(e,events),'PLAYER');return events;}
describe('winter heart authoritative ritual',()=>{
 it('no immediate damage; cast phase is first of three own turns',()=>{const e=setup(),hp=e.state.units.find(u=>u.id==='prey')!.hp;expect(cast(e).ok).toBe(true);expect(e.state.glyphs![0]!.winterHeart).toMatchObject({phase:1,mode:'TILE'});expect(e.state.units.find(u=>u.id==='prey')!.hp).toBe(hp);expect(advance(e)).toEqual([]);expect(e.state.glyphs![0]!.winterHeart!.phase).toBe(2);advance(e);expect(e.state.units.find(u=>u.id==='prey')!.hp).toBe(hp-5);expect(e.state.glyphs).toBeUndefined();});
 it('tile selection may be empty; no winter requires no enemy',()=>{const e=setup();expect(cast(e,p(2,1)).ok).toBe(true);});
 it('winter requires a valid enemy, not empty tile or ally',()=>{const e=setup(true);expect(cast(e,p(2,1)).ok).toBe(false);expect(cast(e,p(1,2)).ok).toBe(false);expect(cast(e).ok).toBe(true);expect(e.state.glyphs![0]!.winterHeart).toMatchObject({mode:'UNIT',targetId:'prey'});});
 it('fixed tile does not follow target and still hits a later occupant',()=>{const e=setup();cast(e);const s=mutable(e),prey=s.units.find(u=>u.id==='prey')!,adj=s.units.find(u=>u.id==='adjacent')!,hp=adj.hp;prey.pos=p(5,2);adj.pos=p(3,2);advance(e);advance(e);expect(e.state.units.find(u=>u.id==='adjacent')!.hp).toBe(hp-5);expect(e.state.units.find(u=>u.id==='prey')!.hp).toBe(prey.hp);});
 it('linked mode follows movement even when winter expires',()=>{const e=setup(true);cast(e);const s=mutable(e),prey=s.units.find(u=>u.id==='prey')!,hp=prey.hp;prey.pos=p(5,2);s.units.find(u=>u.id===e.heroId)!.statuses=[];advance(e);advance(e);expect(e.state.units.find(u=>u.id==='prey')!.hp).toBe(hp-5);});
 it('later winter does not upgrade a tile ritual',()=>{const e=setup();cast(e);mutable(e).units.find(u=>u.id===e.heroId)!.statuses.push({id:'ABSOLUTE_ZERO',turnsLeft:10});expect(e.state.glyphs![0]!.winterHeart!.mode).toBe('TILE');});
 it('death uses final position and never retargets replacement at center',()=>{const e=setup(true);cast(e);const s=mutable(e),prey=s.units.find(u=>u.id==='prey')!,replacement=s.units.find(u=>u.id==='adjacent')!,hp=replacement.hp;prey.pos=p(4,2);dealDamage(ctxFor(e),prey,100,e.heroId,'ARCANE');replacement.pos=p(4,2);expect(s.glyphs![0]!.winterHeart!.lastKnown).toEqual(p(4,2));advance(e);const events=advance(e);expect(events.find(x=>x.type==='GLYPH_ACTIVATED')).toMatchObject({origin:p(4,2)});expect(e.state.units.find(u=>u.id==='adjacent')!.hp).toBe(hp);});
 it('only orthogonal hostile neighbors receive one, not diagonal or allies',()=>{const e=setup(),s=mutable(e),adj=s.units.find(u=>u.id==='adjacent')!,hp=adj.hp;cast(e);advance(e);advance(e);expect(e.state.units.find(u=>u.id==='adjacent')!.hp).toBe(hp-1);expect(e.state.units.find(u=>u.id===e.heroId)!.hp).toBe(s.units.find(u=>u.id===e.heroId)!.hp);});
 it('armor and shields mitigate normal ICE damage',()=>{const e=setup(),prey=mutable(e).units.find(u=>u.id==='prey')!,hp=prey.hp;prey.armor=2;prey.shield=2;cast(e);advance(e);advance(e);expect(e.state.units.find(u=>u.id==='prey')!.hp).toBe(hp-1);});
 it('same turn cannot advance twice; no repeat impact after recovery',()=>{let e=setup();cast(e);resolveGlyphs(ctxFor(e),'PLAYER');expect(e.state.glyphs![0]!.winterHeart!.phase).toBe(1);advance(e);resolveGlyphs(ctxFor(e),'PLAYER');expect(e.state.glyphs![0]!.winterHeart!.phase).toBe(2);e=GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),e.content,e.scenario);expect(advance(e).filter(x=>x.type==='GLYPH_ACTIVATED')).toHaveLength(1);const hp=e.state.units.map(u=>u.hp);expect(advance(e)).toEqual([]);expect(e.state.units.map(u=>u.hp)).toEqual(hp);});
 it('phase survives JSON snapshot without retarget or initial replay',()=>{let e=setup(true);cast(e);advance(e);const heart=structuredClone(e.state.glyphs);e=GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),e.content,e.scenario);expect(e.state.glyphs).toEqual(heart);advance(e);expect(e.state.glyphs).toBeUndefined();});
 it('fall animation owns HP timing, rather than cast anticipation',()=>{const e=setup();cast(e);advance(e);const events=advance(e),plan=compileTimeline(events,k=>k,false);expect(plan.cues.filter(c=>c.event.type==='UNIT_DAMAGED').every(c=>c.at>=660)).toBe(true);});
});
for(const world of [false,true])it(`shared PvP engine both seat projections, mode=${world?'UNIT':'TILE'}`,()=>{const load=validateLoadout(createProfile(DEFAULT_CONTENT),'mage');let state=createDuel([load,load],412);state.player.energy=10;state.player.hand=[{uid:'heart',cardId:id}];const a=state.player.heroId,b=state.duel!.champions.find(id=>id!==a)!;state.units.find(u=>u.id===a)!.pos=p(2,2);state.units.find(u=>u.id===b)!.pos=p(4,2);state.units.find(u=>u.id===b)!.armor=0;if(world)state.units.find(u=>u.id===a)!.statuses.push({id:'ABSOLUTE_ZERO',turnsLeft:10});const hp=state.units.find(u=>u.id===b)!.hp;state=applyDuel(state,{type:'PLAY_CARD',cardUid:'heart',target:p(4,2)}).state;for(const seat of [0,1]as const)expect(duelView(state,seat).glyphs![0]!.winterHeart!.phase).toBe(1);for(let turn=0;turn<4;turn++){state=applyDuel(state,{type:'END_TURN',discardUid:state.player.hand.length>(state.player.handSize??state.player.maxHandSize)?state.player.hand[0]!.uid:undefined}).state;state=JSON.parse(JSON.stringify(state));}expect({hp:state.units.find(u=>u.id===b)!.hp,glyphs:state.glyphs,round:state.round,turns:state.duel?.turns}).toEqual({hp:hp-5,glyphs:undefined,round:3,turns:4});expect(state.glyphs).toBeUndefined();});

for(const world of [false,true])it(`PvE complete normal END_TURN flow, mode=${world?'UNIT':'TILE'}`,()=>{
 const e=makeEngine({hero:{heroId:'mage',pos:p(1,2)},enemies:[{id:'prey',enemyId:'stone_brute',pos:p(4,2)}]});mutable(e).player.energy=10;
 if(world)mutable(e).units.find(u=>u.id===e.heroId)!.statuses.push({id:'ABSOLUTE_ZERO',turnsLeft:10});setHand(e,[id]);expect(cast(e,p(4,2)).ok).toBe(true);
 const prey=e.state.units.find(u=>u.id==='prey')!,hp=prey.hp,armor=prey.armor;
 expect(e.dispatch({type:'END_TURN'}).ok).toBe(true);expect(e.state.glyphs![0]!.winterHeart!.phase).toBe(2);
 expect(e.dispatch({type:'END_TURN'}).ok).toBe(true);expect(e.state.glyphs).toBeUndefined();expect(e.state.units.find(u=>u.id==='prey')!.hp).toBe(hp-(world?5-armor:0));
});
it('enemy turn alone cannot advance the ritual',()=>{const e=setup();cast(e);mutable(e).round++;resolveGlyphs(ctxFor(e),'ENEMY');expect(e.state.glyphs![0]!.winterHeart!.phase).toBe(1);});
it('enemy climate does not enable linked targeting for the caster',()=>{const e=setup();mutable(e).units.find(u=>u.id==='prey')!.statuses.push({id:'ABSOLUTE_ZERO',turnsLeft:10});expect(cast(e,p(2,1)).ok).toBe(true);expect(e.state.glyphs![0]!.winterHeart!.mode).toBe('TILE');});
it('dead caster cleans up its ritual immediately without damage',()=>{const e=setup();cast(e);const hero=mutable(e).units.find(u=>u.id===e.heroId)!;dealDamage(ctxFor(e),hero,100,'prey','ARCANE');expect(e.state.glyphs?.length??0).toBe(0);expect(advance(e)).toEqual([]);});
it('out of range and blocked terrain are invalid without spending energy',()=>{const e=setup();expect(cast(e,p(6,4)).ok).toBe(false);mutable(e).board.tiles[2*7+2]!.terrain='BLOCKED';expect(cast(e,p(2,2)).ok).toBe(false);expect(e.state.player.energy).toBe(30);});
it('diagonal enemies are not struck by shards',()=>{const e=setup(),u=mutable(e).units.find(u=>u.id==='adjacent')!;u.pos=p(4,3);const hp=u.hp;cast(e);advance(e);advance(e);expect(e.state.units.find(x=>x.id===u.id)!.hp).toBe(hp);});
it('Ultra cast retry cannot consume another phase or create another ritual',()=>{const e=setup();expect(cast(e).ok).toBe(true);expect(cast(e).ok).toBe(false);expect(e.state.glyphs).toHaveLength(1);expect(e.state.glyphs![0]!.winterHeart!.phase).toBe(1);});

import {Container} from 'pixi.js';
import {IceSpellEffects} from '../src/presentation/vfx/IceSpellEffects';
it('persistent fragments follow snapshots, reuse nodes, and clean up on impact/exit',()=>{
 const actors=new Container(),ground=new Container(),fx=new IceSpellEffects(actors,ground,{center:p=>({x:p.x*96,y:p.y*48}),footprint:()=>({w:96,h:48}),quad:()=>[],depth:p=>p.y});
 const e=setup(true);cast(e);fx.syncHearts(e.state);expect(actors.children).toHaveLength(1);const node=actors.children[0]!;
 for(let i=0;i<20;i++){fx.syncHearts(JSON.parse(JSON.stringify(e.state)));fx.tick(16);}expect(actors.children[0]).toBe(node);expect(actors.children).toHaveLength(1);
 const oldX=node.x;mutable(e).units.find(u=>u.id==='prey')!.pos=p(4,2);fx.syncHearts(e.state);expect(node.x).toBeGreaterThan(oldX);
 advance(e);fx.syncHearts(e.state);for(let i=0;i<40;i++)fx.tick(16);expect(actors.children).toHaveLength(1);
 const events=advance(e),impact=events.find(x=>x.type==='GLYPH_ACTIVATED')!;if(impact.type!=='GLYPH_ACTIVATED')throw Error('Missing impact');
 fx.heartFall(impact.origin,[impact.origin],impact.glyphId);fx.syncHearts(e.state);for(let i=0;i<120;i++)fx.tick(16);expect(fx.stats.active).toBe(0);expect(actors.children.length+ground.children.length).toBe(0);
 fx.clear();fx.destroy();expect(fx.stats.free).toBe(0);actors.destroy();ground.destroy();
});
