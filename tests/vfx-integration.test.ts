import { expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine } from '../src/game';
import { encounterCheckpoint } from '../src/presentation/qa/act3/integrationFixtures';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
for(const mode of ['first_blood','crystal_guard','duel'])for(const card of ['fireball','bastion_blow','summon_pact_golem','nurture']){
 it(`${mode}: ${card} uses real commands, deterministic snapshots and ordered contact`,()=>{
  const champion=card==='fireball'?'mage':card==='bastion_blow'?'warrior':'summoner';
  const {state,scenario}=encounterCheckpoint(mode,champion)!;
  const hero=state.units.find(u=>u.id===state.player.heroId)!;
  expect(hero.defId).toBe(champion);expect(hero.faction).toBe('PLAYER');
  hero.shield=card==='bastion_blow'?4:0;
  if(card==='nurture')hero.hp-=6;
  state.player.energy=20;state.player.hand=[{uid:'pilot',cardId:card}];
  const before=structuredClone(state),engine=GameEngine.fromSnapshot(state,DEFAULT_CONTENT,scenario);
  const targets=engine.getValidTargets('pilot');expect(targets.length).toBeGreaterThan(0);
  const target=card==='nurture'?hero.pos:card==='summon_pact_golem'?targets[0]!:state.units.find(u=>u.faction==='ENEMY')!.pos;
  const cmd={type:'PLAY_CARD' as const,cardUid:'pilot',target};const r=engine.dispatch(cmd);expect(r.ok).toBe(true);if(!r.ok)return;
  const replay=GameEngine.fromSnapshot(before,DEFAULT_CONTENT,scenario);expect(replay.dispatch(cmd)).toEqual(r);expect(replay.state).toEqual(engine.state);
  const plan=compileTimeline(r.events,id=>DEFAULT_CONTENT.cards[id]?.presentation.visualKey??id,false);
  expect(compileTimeline(JSON.parse(JSON.stringify(r.events)),id=>DEFAULT_CONTENT.cards[id]?.presentation.visualKey??id,false)).toEqual(plan);
  if(card==='summon_pact_golem')expect(r.events.filter(e=>e.type==='UNIT_SPAWNED')).toHaveLength(1);
  else if(card==='nurture')expect(r.events.some(e=>e.type==='UNIT_HEALED'&&e.amount>0)).toBe(true);
  else {expect(r.events.some(e=>e.type==='UNIT_DAMAGED'&&e.hpLost>0)).toBe(true);const at=plan.cues.find(c=>c.kind==='spellImpact')!.at;expect(plan.cues.filter(c=>c.event.type==='UNIT_DAMAGED').every(c=>c.at>=at)).toBe(true);}
 });
}
