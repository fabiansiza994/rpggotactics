import { describe, it, expect } from 'vitest';
import { makeEngine, mutable, ctxFor, p } from './helpers';
import { actSummons, spawnSummon } from '../src/game/domain/summons/summons';
import { applyStatus, cleanseUnit, decrementStatuses, tickStatuses } from '../src/game/domain/statuses/status-rules';
import { activeBloodTrails, leaveBloodTrail, pruneBloodTrails, wolfPursuit } from '../src/game/domain/combat/blood-trail';
import { walkUnit, teleportUnit, pushUnit } from '../src/game/domain/combat/movement';
import { defeatUnit } from '../src/game/domain/combat/damage';
import { DEFAULT_CONTENT, GameEngine, createProfile, DECK_RULES } from '../src/game';
import { copyLimit } from '../src/game/collection/deck-rules';
import { applyDuel, createDuel, duelView, validateLoadout, DUEL_SCENARIO } from '../src/game/pvp/duel';
import { botObservation, planBot } from '../src/game/ai/ranked-bot';
import { botIdentity } from '../src/game/ai/ranked-bot-policy';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import type { GameEvent } from '../src/game/domain/events';

function setup() {
 const e=makeEngine({hero:{heroId:'summoner',pos:p(0,0)}}),s=mutable(e),events:GameEvent[]=[],ctx=ctxFor(e,events);
 const wolf=spawnSummon(ctx,s.units[0]!,'wolf',p(3,2))!;s.round=wolf.summon!.readyRound;
 const prey=s.units.find(u=>u.id==='orc-1')!;prey.pos=p(4,2);prey.hp=prey.maxHp=40;
 return {e,s,events,ctx,wolf,prey};
}
function marked() {const f=setup();applyStatus(f.ctx,f.prey,'BLEEDING',2,f.wolf.id);f.wolf.pos=p(0,2);f.prey.pos=p(5,2);leaveBloodTrail(f.ctx,f.prey,[p(1,2),p(2,2),p(3,2)]);return f;}

describe('Invocar Lobo: authoritative bleeding and bounded pursuit',()=>{
 it('preserves stats, legal copy cap, cost, next-round activation and permanent summon',()=>{
  const f=setup(),d=DEFAULT_CONTENT.summons!.wolf!;expect(d).toMatchObject({maxHp:14,damage:3,moveRange:2,capacityCost:2});
  const card=DEFAULT_CONTENT.cards.summon_wolf!;expect(card.cost).toBe(3);expect(copyLimit(card,DECK_RULES)).toBe(1);expect(card.rulesText).toContain('Instinto de Caza');
  f.s.round=f.wolf.summon!.readyRound-1;actSummons(f.ctx);expect(f.prey.hp).toBe(40);expect(f.wolf.summon?.meltTurnsLeft).toBeUndefined();
 });
 it('a landed melee bite applies one 2-turn status, not a new damage system',()=>{const f=setup();actSummons(f.ctx);expect(f.prey.hp).toBe(37);expect(f.prey.statuses).toContainEqual({id:'BLEEDING',turnsLeft:2,sourceId:f.wolf.id});expect(f.events.some(e=>e.type==='STATUS_APPLIED'&&e.status==='BLEEDING')).toBe(true);});
 it.each(['armor','shield'] as const)('fully absorbed %s prevents bleeding',kind=>{const f=setup();f.prey[kind]=99;actSummons(f.ctx);expect(f.prey.statuses).toEqual([]);});
 it('no friendly bite, no bleeding on an ally',()=>{const f=setup();f.prey.faction=f.wolf.faction;actSummons(f.ctx);expect(f.prey.statuses).toEqual([]);});
 it('ticks exactly once at each of two target starts; armor does not erase the periodic point',()=>{const f=setup();applyStatus(f.ctx,f.prey,'BLEEDING',2,f.wolf.id);f.prey.armor=99;
  for(let i=1;i<=2;i++){tickStatuses(f.ctx,f.prey,'TURN_START');expect(f.prey.hp).toBe(40-i);decrementStatuses(f.ctx,f.prey);}tickStatuses(f.ctx,f.prey,'TURN_START');expect(f.prey.hp).toBe(38);expect(f.prey.statuses).toEqual([]);
  const ticks=f.events.filter(e=>e.type==='UNIT_DAMAGED');expect(ticks.map(e=>e.type==='UNIT_DAMAGED'?e.hpAfter:0)).toEqual([39,38]);
 });
 it('refreshes duration without stacking or duplicating periodic damage',()=>{const f=setup();applyStatus(f.ctx,f.prey,'BLEEDING',2,f.wolf.id);decrementStatuses(f.ctx,f.prey);applyStatus(f.ctx,f.prey,'BLEEDING',2,f.wolf.id);applyStatus(f.ctx,f.prey,'BLEEDING',2,f.wolf.id);expect(f.prey.statuses).toHaveLength(1);expect(f.prey.statuses[0]!.turnsLeft).toBe(2);tickStatuses(f.ctx,f.prey,'TURN_START');expect(f.prey.hp).toBe(39);});
 it('walk emits source/prey-linked deduplicated marks on actual traversed tiles',()=>{const f=setup();applyStatus(f.ctx,f.prey,'BLEEDING',2,f.wolf.id);walkUnit(f.ctx,f.prey,[p(5,2),p(6,2)],2);expect(activeBloodTrails(f.s).map(m=>m.pos)).toEqual([p(4,2),p(5,2),p(6,2)]);leaveBloodTrail(f.ctx,f.prey,[p(5,2)]);expect(f.s.bloodTrails).toHaveLength(3);expect(f.s.bloodTrails?.every(m=>m.wolfId===f.wolf.id&&m.preyId===f.prey.id)).toBe(true);});
 it('teleport does not invent blood across intervening cells; physical pushes do leave it',()=>{const f=setup();applyStatus(f.ctx,f.prey,'BLEEDING',2,f.wolf.id);teleportUnit(f.ctx,f.prey,p(5,2),'test');expect(f.s.bloodTrails??[]).toHaveLength(0);pushUnit(f.ctx,f.prey,'RIGHT',1,0,'test');expect(f.s.bloodTrails?.map(m=>m.pos)).toEqual([p(5,2),p(6,2)]);});
 it('no marks when the target has no bleed or source is not its hostile wolf',()=>{const f=setup();walkUnit(f.ctx,f.prey,[p(5,2)],1);expect(f.s.bloodTrails).toBeUndefined();applyStatus(f.ctx,f.prey,'BLEEDING',2,f.s.player.heroId);leaveBloodTrail(f.ctx,f.prey,[p(4,2)]);expect(activeBloodTrails(f.s)).toHaveLength(0);});
 it('one extra movement only on a trail toward its prey; no permanent speed gain',()=>{const f=marked();const plan=wolfPursuit(f.ctx,f.wolf)!;expect(plan.node.cost).toBe(3);expect(plan.node.pos).toEqual(p(3,2));actSummons(f.ctx);expect(f.wolf.pos).toEqual(p(3,2));expect(f.wolf.moveRange).toBe(2);expect(f.events.filter(e=>e.type==='WOLF_PURSUIT')).toHaveLength(1);actSummons(f.ctx);expect(f.wolf.pos).toEqual(p(3,2));});
 it('without trail uses only its normal movement range',()=>{const f=marked();f.s.bloodTrails=[];expect(wolfPursuit(f.ctx,f.wolf)).toBeNull();actSummons(f.ctx);expect(f.wolf.pos).toEqual(p(2,2));});
 it('does not grant another species any movement',()=>{const f=marked();f.wolf.defId='chicken';expect(wolfPursuit(f.ctx,f.wolf)).toBeNull();});
 it('roots stop pursuit; obstacles and occupied cells are never crossed',()=>{const f=marked();applyStatus(f.ctx,f.wolf,'ROOTED',2,'test');expect(wolfPursuit(f.ctx,f.wolf)).toBeNull();cleanseUnit(f.ctx,f.wolf);const blocker=structuredClone(f.prey);blocker.id='block';blocker.pos=p(1,2);blocker.statuses=[];f.s.units.push(blocker);const route=wolfPursuit(f.ctx,f.wolf);expect(route===null || route.node.path.every(p=>p.x!==1||p.y!==2)).toBe(true);});
 it('a wall across the arena prevents pursuit rather than ignoring blocked ground',()=>{const f=marked();const wallId=Object.keys(DEFAULT_CONTENT.obstacles).find(id=>DEFAULT_CONTENT.obstacles[id]!.blocksMovement)!;for(let y=0;y<f.s.board.height;y++)f.s.obstacles.push({id:'wall-'+y,defId:wallId,pos:p(1,y),turnsLeft:null});expect(wolfPursuit(f.ctx,f.wolf)).toBeNull();});
 it('only the originating wolf can exploit a mark',()=>{const f=marked();f.s.bloodTrails!.forEach(m=>m.wolfId='another-wolf');expect(wolfPursuit(f.ctx,f.wolf)).toBeNull();});
 it('does not reward routes away from the source prey or circles',()=>{const f=marked();f.prey.pos=p(0,3);expect(wolfPursuit(f.ctx,f.wolf)).toBeNull();});
 it('multiple prey/repeated marks still give at most one +1 activation',()=>{const f=marked();const other=structuredClone(f.prey);other.id='prey-2';other.pos=p(6,3);f.s.units.push(other);leaveBloodTrail(f.ctx,other,[p(1,2),p(2,2)]);for(let i=0;i<20;i++)leaveBloodTrail(f.ctx,f.prey,[p(1,2)]);actSummons(f.ctx);expect(f.events.filter(e=>e.type==='WOLF_PURSUIT')).toHaveLength(1);expect(f.wolf.pos).toEqual(p(3,2));});
 it.each(['cleanse','expire','prey-death','wolf-death','round-age','battle-end'] as const)('cleans marks on %s',reason=>{const f=marked();
  if(reason==='cleanse')cleanseUnit(f.ctx,f.prey);if(reason==='expire'){decrementStatuses(f.ctx,f.prey);decrementStatuses(f.ctx,f.prey);}if(reason==='prey-death')defeatUnit(f.ctx,f.prey);if(reason==='wolf-death')defeatUnit(f.ctx,f.wolf);if(reason==='round-age')f.s.round+=2;if(reason==='battle-end')f.s.outcome={result:'WON',reason:'OBJECTIVES_COMPLETED'};
  pruneBloodTrails(f.s);expect(f.s.bloodTrails).toEqual([]);if(reason==='battle-end')expect(f.prey.statuses).toEqual([]);
 });
 it('snapshot reconstruction preserves source, duration, marks and the already consumed activation',()=>{const f=marked();actSummons(f.ctx);const saved=JSON.parse(JSON.stringify(f.s));const e=GameEngine.fromSnapshot(saved,DEFAULT_CONTENT,f.e.scenario);const before=JSON.stringify(e.state);actSummons(ctxFor(e));expect(JSON.stringify(e.state)).toBe(before);expect(activeBloodTrails(mutable(e))).toEqual(activeBloodTrails(f.s));});
 it('generic timeline presents bite, HP and status causally, never inventing a damage value',()=>{const f=setup();actSummons(f.ctx);const t=compileTimeline(f.events,x=>x,false);const hit=t.cues.find(c=>c.event.type==='UNIT_DAMAGED')!;const status=t.cues.find(c=>c.event.type==='STATUS_APPLIED'&&c.event.status==='BLEEDING')!;expect(status.at).toBeGreaterThanOrEqual(hit.at);expect(t.cues.filter(c=>c.event.type==='UNIT_DAMAGED')).toHaveLength(1);});
});

describe('two-seat PvP snapshots, commands and reconnect',()=>{
 it('both clients retain the same public bleed/trail identities across seat swaps and recovery',()=>{
  const profile=createProfile(DEFAULT_CONTENT);let s=createDuel([validateLoadout(profile,'summoner'),validateLoadout(profile,'mage')],7);
  if(s.player.heroId!=='champion-a')s=applyDuel(s,{type:'END_TURN'}).state;
  const ctx={state:s,content:DEFAULT_CONTENT,emit:()=>{}};const owner=s.units.find(u=>u.id==='champion-a')!,prey=s.units.find(u=>u.id==='champion-b')!;
  owner.pos=p(1,1);prey.pos=p(5,2);const wolf=spawnSummon(ctx,owner,'wolf',p(2,2))!;applyStatus(ctx,prey,'BLEEDING',2,wolf.id);leaveBloodTrail(ctx,prey,[p(3,2),p(4,2)]);
  for(const seat of [0,1] as const){const wire=JSON.parse(JSON.stringify(duelView(s,seat)));const e=GameEngine.fromSnapshot(wire,DEFAULT_CONTENT,DUEL_SCENARIO);expect(activeBloodTrails(mutable(e))).toEqual(activeBloodTrails(s));expect(e.state.units.find(u=>u.id===prey.id)?.statuses).toEqual(prey.statuses);}
  const observed=botObservation(s,s.duel!.active,DEFAULT_CONTENT);const bot={...botIdentity('wolf-qa',600,7),heroId:'summoner' as const,level:2};const planned=planBot(observed,DEFAULT_CONTENT,bot,{clock:()=>0});expect(()=>applyDuel(s,planned.command)).not.toThrow();
  const before=prey.hp;const next=applyDuel(s,{type:'END_TURN'});expect(next.events.length).toBeGreaterThan(0);expect(next.state.units.find(u=>u.id===prey.id)?.hp).toBe(before-1);
 });
});
