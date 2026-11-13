import {describe,it,expect} from 'vitest';
import {makeEngine,setHand,p,mutable} from './helpers';
import {parseCommand} from '../src/game/run/verify';
import {validCommand} from '../server/src/pvp';
import {createDuel,applyDuel,duelView,validateLoadout} from '../src/game/pvp/duel';
import {createProfile,DEFAULT_CONTENT} from '../src/game';

describe('Ice Wall explicit orientation',()=>{
 for(const orientation of ['HORIZONTAL','VERTICAL'] as const) it(`${orientation}: preview = authoritative footprint, same cost/duration`,()=>{
  const e=makeEngine();const uid=setHand(e,['ice_wall'])[0]!;e.wallOrientation=orientation;
  const preview=e.previewCard(uid,p(2,2));expect(preview.valid).toBe(true);expect(preview.resolved?.affectedTiles).toHaveLength(3);
  const command=e.selectionCommand(uid,p(2,2));expect(parseCommand(command)).toEqual(command);expect(validCommand(command)).toBe(true);
  const energy=e.state.player.energy;expect(e.dispatch(command).ok).toBe(true);
  expect(e.state.obstacles.map(o=>o.pos)).toEqual(preview.resolved?.affectedTiles);
  expect(e.state.obstacles.every(o=>o.turnsLeft===2)).toBe(true);expect(e.state.player.energy).toBe(energy-2);
  expect(new Set(e.state.obstacles.map(o=>orientation==='HORIZONTAL'?o.pos.y:o.pos.x)).size).toBe(1);
 });
 it('retains orientation when moving target, without mutating state on previews',()=>{
  const e=makeEngine();const uid=setHand(e,['ice_wall'])[0]!;e.wallOrientation='VERTICAL';const before=structuredClone(e.state);
  for(const target of [p(1,2),p(2,2),p(1,1)]){const v=e.previewCard(uid,target);expect(v.valid).toBe(true);expect(v.resolved?.affectedTiles.every(t=>t.x===target.x)).toBe(true);}
  expect(e.state).toEqual(before);expect(e.wallOrientation).toBe('VERTICAL');
 });
 for(const orientation of ['HORIZONTAL','VERTICAL'] as const) it(`${orientation}: refuses incomplete edge footprint without spending`,()=>{
  const e=makeEngine();const uid=setHand(e,['ice_wall'])[0]!;e.wallOrientation=orientation;const target=orientation==='HORIZONTAL'?p(0,1):p(1,0);const before=structuredClone(e.state);
  expect(e.previewCard(uid,target).valid).toBe(false);expect(e.getValidTargets(uid)).not.toContainEqual(target);
  expect(e.dispatch(e.selectionCommand(uid,target)).ok).toBe(false);expect(e.state).toEqual(before);
 });
 for(const blocked of ['obstacle','unit','terrain'] as const) it(`refuses ${blocked} in a side cell`,()=>{
  const e=makeEngine();const uid=setHand(e,['ice_wall'])[0]!;const s=mutable(e);
  if(blocked==='obstacle')s.obstacles.push({id:'block',defId:'pillar',pos:p(3,2),turnsLeft:null});
  if(blocked==='unit')s.units.find(u=>u.id==='orc-1')!.pos=p(3,2);
  if(blocked==='terrain')s.board.tiles[2*s.board.width+3]!.terrain='BLOCKED';
  const before=structuredClone(e.state);expect(e.previewCard(uid,p(2,2)).valid).toBe(false);expect(e.dispatch(e.selectionCommand(uid,p(2,2))).ok).toBe(false);expect(e.state).toEqual(before);
 });
 it('rejects malformed axes and axes on other cards',()=>{
  const e=makeEngine();const uid=setHand(e,['fireball'])[0]!;expect(e.dispatch({type:'PLAY_CARD',cardUid:uid,target:p(3,2),wallOrientation:'VERTICAL'}).ok).toBe(false);
  const bad={type:'PLAY_CARD',cardUid:uid,target:p(1,2),wallOrientation:'DIAGONAL'};expect(validCommand(bad)).toBe(false);expect(parseCommand(bad)).toBeNull();
 });
 it('out-of-range preview shows its footprint but cannot resolve',()=>{const e=makeEngine();const uid=setHand(e,['ice_wall'])[0]!;const v=e.previewCard(uid,p(4,1));expect(v.valid).toBe(false);expect(v.resolved?.affectedTiles).toHaveLength(3);expect(e.dispatch(e.selectionCommand(uid,p(4,1))).ok).toBe(false);});
 it('legacy commands retain perpendicular behaviour',()=>{
  const e=makeEngine();const uid=setHand(e,['ice_wall'])[0]!;expect(e.dispatch({type:'PLAY_CARD',cardUid:uid,target:p(2,2)}).ok).toBe(true);expect(e.state.obstacles.every(o=>o.pos.x===2)).toBe(true);
 });
 for(const orientation of ['HORIZONTAL','VERTICAL'] as const) it(`PvP ${orientation}: both snapshots and replay agree`,()=>{
  const profile=createProfile(DEFAULT_CONTENT);const state=createDuel([validateLoadout(profile,'mage'),validateLoadout(profile,'mage')],17);state.units.find(u=>u.id===state.player.heroId)!.pos=p(0,3);state.units.find(u=>u.id!==state.player.heroId)!.pos=p(6,4);state.obstacles=[];state.board.tiles.forEach(t=>t.terrain='NORMAL');state.player.hand=[{uid:'wall',cardId:'ice_wall'}];state.player.energy=5;
  const cmd={type:'PLAY_CARD' as const,cardUid:'wall',target:p(2,2),wallOrientation:orientation};const result=applyDuel(state,cmd);expect(result.events.some(e=>e.type==='CARD_PLAYED')).toBe(true);
  expect(duelView(result.state,0).obstacles).toEqual(duelView(result.state,1).obstacles);expect(result.state.obstacles).toHaveLength(3);
  expect(applyDuel(structuredClone(state),parseCommand(JSON.parse(JSON.stringify(cmd)))!).state).toEqual(result.state);
 });
});
