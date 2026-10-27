import {useBattleStore} from '../src/presentation/store/battleStore';
import {describe,it,expect} from 'vitest';
import {GameEngine,DEFAULT_CONTENT,encounterFor,replayBattle} from '../src/game';
import {TEMPLE_CAMPAIGN} from '../src/game/data/temple-encounters';
import {puzzlePresentation,mechanismHint,PUZZLE_SOUND_HOOKS} from '../src/presentation/mechanisms/puzzlePresentation';
import {bridgeGroups,structureProgress} from '../src/presentation/pixi/TempleStructures';
import {boardActionWins} from '../src/presentation/pixi/boardInput';
import {safeRepeatableControl} from '../src/game/domain/mechanisms/mechanism-rules';
const engine=(id:string)=>new GameEngine(encounterFor(TEMPLE_CAMPAIGN,id,'mage'),DEFAULT_CONTENT);
describe('Act III UX correction',()=>{
 it('provides six distinct nonmodal rules and live simultaneous seal progress',()=>{
  for(let i=1;i<=6;i++)expect(puzzlePresentation(engine(`w3_e0${i}`).state)?.introHint.length).toBeGreaterThan(20);
  const e=engine('w3_e03');expect(puzzlePresentation(e.state)).toMatchObject({progressCurrent:0,progressTotal:3});
  expect(e.dispatch({type:'MOVE_UNIT',unitId:e.heroId,to:{x:1,y:1}}).ok).toBe(true);
  expect(puzzlePresentation(e.state)).toMatchObject({progressCurrent:1,progressTotal:3});
  expect(puzzlePresentation(e.state)?.contextualHint).toContain('al mismo tiempo');
  const progressed=structuredClone(e.state);
  progressed.mechanisms!.objects.find(o=>o.def.id==='seal-b')!.active=true;
  expect(puzzlePresentation(progressed)?.progressCurrent).toBe(2);
  expect(puzzlePresentation(progressed)?.contextualHint).toContain('falta uno');
  progressed.mechanisms!.objects.find(o=>o.def.id==='seal-c')!.active=true;
  expect(puzzlePresentation(progressed)?.progressCurrent).toBe(3);
  expect(puzzlePresentation(progressed)?.contextualHint).toContain('Cámara abierta');
 });
 it('uses real Guardian state for the attack-now cue and rune completion for progress',()=>{
  const e=engine('w3_e05'),s=structuredClone(e.state);s.mechanisms!.exposed={guardian:s.round+1};
  expect(puzzlePresentation(s)?.contextualHint).toContain('ATÁCALO AHORA');
  expect(puzzlePresentation(e.state)?.guardian?.exposed).toBe(false);
  const r=structuredClone(engine('w3_e06').state);r.mechanisms!.sequences={'sun-then-moon':1};
  expect(puzzlePresentation(r)?.contextualHint).toContain('Runa Lunar');
  r.mechanisms!.fired.push('sun-then-moon');expect(puzzlePresentation(r)?.progressCurrent).toBe(2);
 });
 it('gives different affordances to weight, push, rune and relic families',()=>{
  const v=engine('w3_e03').getMechanismView()!;
  expect(mechanismHint(v.objects.find(o=>o.kind==='PRESSURE_PLATE')!)).toContain('peso');
  expect(mechanismHint(v.objects.find(o=>o.kind==='STATUE')!)).toContain('Empújala');
  expect(mechanismHint(v.objects.find(o=>o.kind==='RELIC')!)).toContain('Recógela');
  expect(PUZZLE_SOUND_HOOKS.GATE_OPENED).toBe('DOOR_OPEN');
 });
 it('builds one continuous bridge and bounds reversible mechanical motion',()=>{
  expect(bridgeGroups(engine('w3_e02').getMechanismView()!.objects).map(g=>g.length)).toEqual([2]);
  expect(structureProgress(0,1,250,false)).toBe(.5);expect(structureProgress(.8,1,500,false)).toBe(1);
  expect(structureProgress(1,0,100,false)).toBe(.8);expect(structureProgress(0,1,0,true)).toBe(1);
 });
 it('prioritizes movement/targeting floors over secondary inspection',()=>{
  const p={x:2,y:2};expect(boardActionWins(p,[p],[])).toBe(true);expect(boardActionWins(p,[],[p])).toBe(true);
  expect(boardActionWins(p,[],[])).toBe(false);expect(boardActionWins(null,[p],[])).toBe(false);
 });
 it('moves onto a passive plate on the first click instead of selecting its object',()=>{
  const e=engine('w3_e03');
  useBattleStore.setState({engine:e,state:e.state,selectedCardUid:null,selectedMechanismId:null,introLocked:false,playbackBusy:false,handDiscard:null,onlineCommand:null});
  useBattleStore.getState().clickTile({x:1,y:1});
  expect(e.state.units.find(u=>u.id===e.heroId)!.pos).toEqual({x:1,y:1});
  expect(useBattleStore.getState().selectedMechanismId).toBeNull();
 });
 it('walks through an open gate on its first click without intercepting the tile',()=>{
  const original=engine('w3_e01'),state=structuredClone(original.state);
  state.units.find(u=>u.id===original.heroId)!.pos={x:4,y:2};
  const gate=state.mechanisms!.objects.find(o=>o.def.id==='gate')!;gate.state='OPEN';gate.active=true;
  const e=GameEngine.fromSnapshot(state,original.content,original.scenario);
  useBattleStore.setState({engine:e,state:e.state,selectedCardUid:null,selectedMechanismId:null,introLocked:false,playbackBusy:false,handDiscard:null,onlineCommand:null});
  useBattleStore.getState().clickTile({x:5,y:2});
  expect(e.state.units.find(u=>u.id===e.heroId)!.pos).toEqual({x:5,y:2});
  expect(useBattleStore.getState().selectedMechanismId).toBeNull();
 });
 it('permits the SAME audited reversible control twice while preserving replay and resources',()=>{
  const e=engine('w3_e04');expect(e.dispatch({type:'MOVE_UNIT',unitId:e.heroId,to:{x:2,y:5}}).ok).toBe(true);
  const hp=e.state.units.find(u=>u.id===e.heroId)!.hp,energy=e.state.player.energy,mp=e.state.player.movePoints;
  expect(e.dispatch({type:'INTERACT',mechanismId:'lever-a'}).ok).toBe(true);
  expect(e.dispatch({type:'INTERACT',mechanismId:'lever-a'}).ok).toBe(true);
  expect(e.state.round).toBe(1);expect(e.state.player.energy).toBe(energy);expect(e.state.player.movePoints).toBe(mp);
  expect(e.state.units.find(u=>u.id===e.heroId)!.hp).toBe(hp);
  const replay=replayBattle(e.scenario,e.content,e.seed,e.history);expect(replay.rejectedAt).toBeNull();expect(replay.state).toEqual(e.state);
 });
 it('fails closed for legacy saves, other controls and effectful rule graphs',()=>{
  const e=engine('w3_e04');e.dispatch({type:'MOVE_UNIT',unitId:e.heroId,to:{x:2,y:5}});
  e.dispatch({type:'INTERACT',mechanismId:'lever-a'});
  expect(e.dispatch({type:'INTERACT',mechanismId:'reset'}).ok).toBe(false);
  const b=structuredClone(e.state.mechanisms!);delete b.lastInteractionId;
  expect(safeRepeatableControl(b,'lever-a')).toBe(true); // permission additionally requires a matching saved id
  const legacy=GameEngine.fromSnapshot({...structuredClone(e.state),mechanisms:b},e.content,e.scenario);
  expect(legacy.getInteractions().find(o=>o.mechanismId==='lever-a')?.allowed).toBe(false);
  b.rules.push({id:'unsafe',trigger:{type:'ON_INTERACT',sources:['lever-a']},actions:[{type:'OPEN',targets:['gate']}]});
  expect(safeRepeatableControl(b,'lever-a')).toBe(false);
  expect(safeRepeatableControl(engine('w3_e05').state.mechanisms!,'lever')).toBe(false);
 });
});
