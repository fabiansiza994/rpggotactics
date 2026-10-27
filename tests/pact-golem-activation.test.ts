import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, createProfile } from '../src/game';
import { applyDuel, createDuel, duelView, validateLoadout } from '../src/game/pvp/duel';
import { endTurn, makeEngine, mutable, setHand } from './helpers';

const content = DEFAULT_CONTENT;
const load = validateLoadout(createProfile(content), 'summoner');

// Controlled local fixtures only. No account, database or production state is touched.
for (const seat of [0, 1] as const) describe(`Pact Golem owner seat ${seat}`, () => {
  function setup(distance: number) {
    let s = createDuel([load, load], 7);
    while (s.duel!.active !== seat) s = applyDuel(s, endTurn(s)).state;
    s.units.find(u => u.id === s.player.heroId)!.pos = {x: 1, y: 2};
    s.units.find(u => u.id !== s.player.heroId)!.pos = {x: 2 + distance, y: 2};
    s.player.energy = 4;
    s.player.hand = [{uid: 'qa-golem', cardId: 'summon_pact_golem'}];
    const result = applyDuel(s, {type:'PLAY_CARD',cardUid:'qa-golem',target:{x:2,y:2}});
    return result.state;
  }
  for (const distance of [3, 5]) it(`spawn, next owner turn and both wire views: distance ${distance}`, () => {
    let s = setup(distance);
    const g = s.units.find(u => u.defId === 'pact_golem')!;
    const id = g.id, ownerId = s.player.heroId, round = s.round;
    expect(g).toMatchObject({moveRange:2, pos:{x:2,y:2}, summon:{ownerId,readyRound:round+1,lastActedRound:0}});
    expect(() => applyDuel(s,{type:'MOVE_UNIT',unitId:id,to:{x:2,y:3}})).toThrow();
    const fresh = applyDuel(s,endTurn(s));
    expect(fresh.events.some(e => e.type==='UNIT_MOVED' && e.unitId===id)).toBe(false);
    s = applyDuel(fresh.state,endTurn(fresh.state)).state;
    expect(s.duel!.active).toBe(seat);
    expect(s.round).toBe(round+1);
    const snapshot = structuredClone(s), command = endTurn(s);
    const acted = applyDuel(s,command);
    const moved = acted.events.filter(e=>e.type==='UNIT_MOVED' && e.unitId===id);
    expect(moved.length>0).toBe(distance===3);
    const final = acted.state.units.find(u=>u.id===id)!;
    expect(final.summon!.lastActedRound).toBe(round+1);
    expect(final.pos).toEqual(distance===3?{x:4,y:2}:{x:2,y:2});
    for(const viewer of [0,1] as const) {
      const wire=duelView(acted.state,viewer).units.find(u=>u.id===id)!;
      expect(wire.pos).toEqual(final.pos);
      expect(wire.summon).toEqual(final.summon);
      expect(wire.faction).toBe(viewer===seat?'PLAYER':'ENEMY');
    }
    expect(applyDuel(snapshot,command)).toEqual(acted);
  });
});
it('PvE uses the same guard rule: no action on summon round, advances and attacks next round',()=>{
  const e=makeEngine({hero:{heroId:'summoner',pos:{x:1,y:2}},enemies:[{id:'orc',enemyId:'orc_warrior',pos:{x:5,y:2}}]});
  mutable(e).units.find(u=>u.id==='orc')!.moveRange=0;
  mutable(e).player.energy=4;
  const [uid]=setHand(e,['summon_pact_golem']);
  expect(e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:{x:2,y:2}}).ok).toBe(true);
  const id=e.state.units.find(u=>u.defId==='pact_golem')!.id;
  e.dispatch(endTurn(e));
  expect(e.state.units.find(u=>u.id===id)!.pos).toEqual({x:2,y:2});
  const next=e.dispatch(endTurn(e));
  expect(next.ok).toBe(true);
  expect(next.ok && next.events.some(ev=>ev.type==='SUMMON_ATTACKED' && ev.unitId===id)).toBe(true);
  expect(e.state.units.find(u=>u.id===id)!.pos).toEqual({x:4,y:2});
});
