import {beastsEnabled} from './beasts-release';
import type { RuleContext } from '../context';
import type { GameState } from '../state';
import type { Unit } from '../entities/unit';
import { manhattan, samePos, comparePos, type Pos } from '../core/position';
import { nextRandom } from '../core/rng';
import { canEnter, effectiveMoveRange, isMovementPrevented, terrainDefAt } from '../board/occupancy';
import { computeReachable, type PathNode } from '../board/pathfinding';
import { hasLineOfSight } from '../board/line-of-sight';
import { healUnit } from './damage';

export const weakenedPrey = (unit: Unit): boolean => unit.hp > 0 && unit.maxHp > 0 && unit.hp * 10 <= unit.maxHp * 3;
export function activeLifeFeathers(state: GameState): NonNullable<GameState['lifeFeathers']> {
  if(state.outcome)return [];
  return (state.lifeFeathers??[]).filter(f=>f.expiresRound>state.round&&state.units.some(u=>u.id===f.ownerId&&u.kind==='HERO'&&u.defId==='summoner'&&u.hp>0));
}
export function pruneLifeFeathers(state: GameState): void {
  if(state.lifeFeathers)state.lifeFeathers=activeLifeFeathers(state);
}
/** One authoritative roll per mature activation with a real walk; the failed roll is also persisted. */
export function shedLifeFeather(ctx: RuleContext, raven: Unit, traversed: readonly Pos[]): void {
  if(!beastsEnabled(ctx.state))return;
  pruneLifeFeathers(ctx.state);
  if(!beastsEnabled(ctx.state)||raven.defId!=='raven'||raven.kind!=='SUMMON'||!raven.summon||!ctx.state.units.includes(raven)||raven.hp<=0||traversed.length<2)return;
  if(samePos(traversed[0]!,traversed[traversed.length-1]!))return;
  if(ctx.state.round<raven.summon.readyRound||raven.summon.featherRollRound===ctx.state.round)return;
  raven.summon.featherRollRound=ctx.state.round;
  const feathers=ctx.state.lifeFeathers??[];
  if(feathers.filter(f=>f.ravenId===raven.id).length>=3)return;
  const owner=ctx.state.units.find(u=>u.id===raven.summon!.ownerId&&u.defId==='summoner'&&u.kind==='HERO');
  if(!owner)return;
  const pos=traversed.slice(0,-1).reverse().find(p=>canEnter(ctx,p,raven.id)&&!terrainDefAt(ctx,p)?.isHazard&&!feathers.some(f=>samePos(f.pos,p)));
  if(!pos||nextRandom(ctx.state)>=0.35)return;
  const feather={id:`feather-${ctx.state.nextId++}`,ownerId:owner.id,ravenId:raven.id,pos:{...pos},expiresRound:ctx.state.round+2};
  (ctx.state.lifeFeathers??=[]).push(feather);
  ctx.emit({type:'LIFE_FEATHER_CREATED',...feather});
}
/** Removal precedes healing inside the engine draft transaction; a replay cannot grant it twice. */
export function collectLifeFeathers(ctx: RuleContext, unit: Unit, traversed: readonly Pos[]): void {
  if(!beastsEnabled(ctx.state))return;
  pruneLifeFeathers(ctx.state);
  if(unit.kind!=='HERO'||unit.defId!=='summoner'||unit.hp<=0)return;
  for(const pos of traversed)for(const feather of [...(ctx.state.lifeFeathers??[])]) {
    if(feather.ownerId!==unit.id||!samePos(feather.pos,pos)||unit.hp>=unit.maxHp)continue;
    ctx.state.lifeFeathers=ctx.state.lifeFeathers!.filter(f=>f.id!==feather.id);
    ctx.emit({type:'LIFE_FEATHER_COLLECTED',featherId:feather.id,unitId:unit.id,pos:feather.pos});
    healUnit(ctx,unit,1,feather.id);
  }
}
export function ravenPursuit(ctx: RuleContext, raven: Unit, preferred?: Unit): {node:PathNode;prey:Unit}|null {
  if(!beastsEnabled(ctx.state)||raven.defId!=='raven'||raven.kind!=='SUMMON'||isMovementPrevented(ctx,raven))return null;
  const budget=Math.min(4,effectiveMoveRange(ctx,raven));if(budget>=4)return null;
  const nodes=[...computeReachable(ctx,raven,budget+1).values()];
  const choices:{node:PathNode;prey:Unit}[]=[];
  for(const prey of ctx.state.units){
    if(prey.faction===raven.faction||!weakenedPrey(prey)||(preferred&&preferred.id!==prey.id))continue;
    const distance=manhattan(raven.pos,prey.pos);
    if(distance<=3&&hasLineOfSight(ctx,raven.pos,prey.pos))continue;
    for(const node of nodes)if(node.cost>budget&&manhattan(node.pos,prey.pos)<distance&&manhattan(node.pos,prey.pos)>=2&&!node.path.some(p=>terrainDefAt(ctx,p)?.isHazard))choices.push({node,prey});
  }
  choices.sort((a,b)=>Number(!(manhattan(a.node.pos,a.prey.pos)<=3&&hasLineOfSight(ctx,a.node.pos,a.prey.pos)))-Number(!(manhattan(b.node.pos,b.prey.pos)<=3&&hasLineOfSight(ctx,b.node.pos,b.prey.pos)))||manhattan(a.node.pos,a.prey.pos)-manhattan(b.node.pos,b.prey.pos)||a.node.cost-b.node.cost||a.prey.id.localeCompare(b.prey.id)||comparePos(a.node.pos,b.node.pos));
  return choices[0]??null;
}
