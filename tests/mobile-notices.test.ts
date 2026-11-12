import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../src/game';
import { OpponentNotices, noticeLane, type OpponentNotice } from '../src/presentation/mobile/OpponentNotices';
import { makeEngine } from './helpers';
afterEach(()=>vi.useRealTimers());
function rig(){vi.useFakeTimers();let time=0,rows:OpponentNotice[]=[];const engine=makeEngine();const state=engine.state,hero=engine.heroId;const n=new OpponentNotices(v=>{rows=v;},()=>time);return {n,engine,state,hero,get rows(){return rows;},advance(ms:number){time+=ms;vi.advanceTimersByTime(ms);}};}
function damage(hero:string,hpLost=3):GameEvent{return {type:'UNIT_DAMAGED',unitId:hero,sourceId:'orc-1',damageType:'PHYSICAL',pos:{x:0,y:2},rawAmount:3,armorMitigated:0,shieldAbsorbed:hpLost?0:3,hpLost,hpAfter:20-hpLost};}
describe('Mobile 3 presentation and privacy',()=>{
 it('does not display on registration; groups attack, damage and defeat only as each is presented',()=>{
  const r=rig();const attack:GameEvent={type:'ENEMY_ATTACKED',enemyId:'orc-1',intentKind:'MELEE_ATTACK',tiles:[],targetUnitIds:[r.hero],damageType:'PHYSICAL'};const d=damage(r.hero),death:GameEvent={type:'UNIT_DEFEATED',unitId:r.hero,faction:'PLAYER',kind:'HERO',pos:{x:0,y:2}};
  const start:GameEvent={type:'ENEMY_ACTION_STARTED',enemyId:'orc-1',intent:{kind:'IDLE',enemyId:'orc-1',reason:'NO_TARGET'}};
  r.n.register([start,attack,d,death],r.state,r.engine.content,r.hero);expect(r.rows).toEqual([]);
  r.n.present(attack,r.state);expect(r.rows[0]?.text).not.toContain('−3');
  r.n.present(d,r.state);expect(r.rows).toHaveLength(1);expect(r.rows[0]).toMatchObject({priority:3,expires:3400});expect(r.rows[0]?.text).toContain('−3');
  r.n.present(death,r.state);expect(r.rows).toHaveLength(1);expect(r.rows[0]?.text).toContain('cae');r.n.destroy();
 });
 it('blocks cloned replay batches, repeat contacts and stale unpresented events',()=>{
  const r=rig(),d=damage(r.hero);r.n.register([d],r.state,r.engine.content,r.hero);r.n.present(d,r.state);r.n.present(d,r.state);expect(r.rows).toHaveLength(1);
  r.advance(3500);expect(r.rows).toHaveLength(0);const copy=structuredClone(d);r.n.register([copy],r.state,r.engine.content,r.hero);r.n.present(copy,r.state);expect(r.rows).toHaveLength(0);
  const next=damage(r.hero,2);r.n.register([next],r.state,r.engine.content,r.hero);r.advance(6001);r.n.present(next,r.state);expect(r.rows).toHaveLength(0);r.n.destroy();
 });
 it('uses content names, not username; ignores hands and private ritual pieces',()=>{
  const r=rig();const enemy=r.state.units.find(u=>u.id==='orc-1')!;enemy.name='PRIVATE_USERNAME';
  const hidden:GameEvent={type:'RITUAL_PIECE_COMMITTED',casterId:'orc-1',cardUid:'PRIVATE_UID',cardId:'PRIVATE_PIECE',altarSize:1,energyCost:1};
  const c:GameEvent={type:'CARD_PLAYED',cardUid:'public-card',cardId:'fireball',casterId:'orc-1',target:null,impact:{x:0,y:2},affectedTiles:[],direction:null};
  r.n.register([hidden,c],r.state,r.engine.content,r.hero);r.n.present(hidden,r.state);expect(r.rows).toHaveLength(0);r.n.present(c,r.state);expect(r.rows[0]?.text).toContain('Fireball');expect(JSON.stringify(r.rows)).not.toMatch(/PRIVATE/);r.n.destroy();
 });
 it('does not invent HP loss on shield absorption and preserves distinct repeated occurrences within a batch',()=>{
  const r=rig(),d=damage(r.hero,0),d2=structuredClone(d);r.n.register([d,d2],r.state,r.engine.content,r.hero);r.n.present(d,r.state);r.n.present(d2,r.state);expect(r.rows).toHaveLength(2);expect(JSON.stringify(r.rows)).not.toContain('−');expect(r.rows[0]?.text).toContain('escudo absorbe');r.n.destroy();
 });
 it('prioritizes champion damage over movement; caps capacity and clears within 1.2s of actual player turn',()=>{
  const r=rig(),d=damage(r.hero);const move:GameEvent={type:'UNIT_MOVED',unitId:'orc-1',from:{x:6,y:2},to:{x:5,y:2},path:[{x:5,y:2}],cost:1,mode:'WALK'};
  r.n.setCapacity(1);r.n.register([move,d],r.state,r.engine.content,r.hero);r.n.present(d,r.state);r.n.present(move,r.state);expect(r.rows).toHaveLength(1);expect(r.rows[0]?.priority).toBe(3);
  r.n.present({type:'TURN_STARTED',faction:'PLAYER',round:2},r.state);r.advance(1200);expect(r.rows).toHaveLength(0);r.n.destroy();
 });
 it('formats public healing, shields, status, spawn, traps and ritual without revealing pieces',()=>{
  const r=rig();const events:GameEvent[]=[{type:'UNIT_HEALED',unitId:'orc-1',sourceId:'orc-1',amount:2,hpAfter:8},{type:'SHIELD_GAINED',unitId:'orc-1',sourceId:'orc-1',amount:2,total:2},{type:'STATUS_APPLIED',unitId:'orc-1',sourceId:'orc-1',status:'BURNING',turnsLeft:2},{type:'UNIT_SPAWNED',unitId:'orc-1',faction:'ENEMY',kind:'ENEMY',pos:{x:6,y:2}},{type:'TRAP_PLACED',ownerId:'orc-1',trapId:'t',kind:'net',pos:{x:2,y:2},turnsLeft:2},{type:'RITUAL_ACTIVATED',casterId:'orc-1',ritualId:'r',tier:'MINOR',pieces:[{cardId:'SECRET',cardUid:'SECRET'}],target:null,impact:{x:2,y:2},affectedTiles:[]}];
  r.n.register(events,r.state,r.engine.content,r.hero);for(const e of events){r.n.present(e,r.state);expect(r.rows.length).toBeGreaterThan(0);expect(JSON.stringify(r.rows)).not.toContain('SECRET');}r.n.destroy();r.advance(10000);expect(r.rows).toEqual([]);
 });
 it('keeps multiple-target damage distinct and does not mutate authoritative facts',()=>{
  const r=rig();const a:GameEvent={type:'ENEMY_ACTION_STARTED',enemyId:'orc-1',intent:{kind:'IDLE',enemyId:'orc-1',reason:'NO_TARGET'}};const d=damage(r.hero),d2={...damage('other'),hpLost:2};const before=JSON.stringify([r.state,a,d,d2]);r.n.register([a,d,d2],r.state,r.engine.content,r.hero);r.n.present(d,r.state);r.n.present(d2,r.state);expect(r.rows[0]?.text).toContain('2 objetivos · −5');expect(JSON.stringify([r.state,a,d,d2])).toBe(before);r.n.destroy();
 });
});
it.each([0,24,42,76,110])('uses only the available lane (%spx) and never extends into the HUD',gap=>{const l=noticeLane(4,500,306,500+gap);expect(l.top).toBeGreaterThan(500);expect(l.capacity).toBeLessThanOrEqual(2);if(l.capacity)expect(l.top+l.capacity*32).toBeLessThanOrEqual(500+gap);});

it('cancels pending UI on scene reset and permits the same facts in a genuinely new battle',()=>{
 const r=rig(),event=damage(r.hero);r.n.register([event],r.state,r.engine.content,r.hero);r.n.present(event,r.state);expect(r.rows).toHaveLength(1);r.n.reset();r.advance(10000);expect(r.rows).toEqual([]);r.n.present(event,r.state);expect(r.rows).toEqual([]);const next=structuredClone(event);r.n.register([next],r.state,r.engine.content,r.hero);r.n.present(next,r.state);expect(r.rows).toHaveLength(1);r.n.destroy();
});

it('retains public identity and own faction when the final state already removed a defeated unit',()=>{
 const r=rig(),d=damage(r.hero);const end={...r.state,units:r.state.units.filter(u=>u.id!==r.hero)};const death:GameEvent={type:'UNIT_DEFEATED',unitId:r.hero,faction:'PLAYER',kind:'HERO',pos:{x:0,y:2}};
 r.n.register([d,death],end,r.engine.content,r.hero,r.state);r.n.present(d,end);expect(r.rows[0]?.text).toContain('Mago');r.n.present(death,end);expect(r.rows).toHaveLength(1);expect(r.rows[0]?.priority).toBe(3);r.n.destroy();
});
